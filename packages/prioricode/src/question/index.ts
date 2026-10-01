import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Deferred, Effect, Layer, Schema, Context } from "effect"
import * as Stream from "effect/Stream"
import { LLMEvent } from "@prioricode/llm"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import { QuestionID } from "./schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { QuestionV1 } from "@prioricode/schema/question-v1"
import { SessionV1 } from "@prioricode/core/v1/session"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { LLM } from "@/session/llm"
import { CONSULT_SYSTEM, buildConsultPrompt, fallbackAnswers, parseConsult } from "./consult"

export const Option = QuestionV1.Option
export type Option = typeof Option.Type
export const Info = QuestionV1.Info
export type Info = typeof Info.Type
export const Prompt = QuestionV1.Prompt
export type Prompt = typeof Prompt.Type
export const Tool = QuestionV1.Tool
export type Tool = typeof Tool.Type
export const Request = QuestionV1.Request
export type Request = typeof Request.Type
export const Answer = QuestionV1.Answer
export type Answer = typeof Answer.Type
export const Reply = QuestionV1.Reply
export type Reply = typeof Reply.Type
export const Replied = QuestionV1.Replied
export const Rejected = QuestionV1.Rejected
export const Event = QuestionV1.Event

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionRejectedError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Question.NotFoundError", {
  requestID: QuestionID,
}) {}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<ReadonlyArray<Answer>, RejectedError>
}

interface State {
  pending: Map<QuestionID, PendingEntry>
}

// Service

export interface Interface {
  readonly ask: (input: {
    sessionID: SessionID
    questions: ReadonlyArray<Info>
    tool?: Tool
  }) => Effect.Effect<ReadonlyArray<Answer>, RejectedError>
  readonly reply: (input: {
    requestID: QuestionID
    answers: ReadonlyArray<Answer>
  }) => Effect.Effect<void, NotFoundError>
  readonly reject: (requestID: QuestionID) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/Question") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const sessions = yield* Session.Service
    const provider = yield* Provider.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Question.state")(function* () {
        const state = {
          pending: new Map<QuestionID, PendingEntry>(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const tailContext = (msgs: SessionV1.WithParts[]) =>
      msgs
        .slice(-10)
        .flatMap((msg) =>
          msg.parts
            .filter(
              (part): part is SessionV1.TextPart =>
                part.type === "text" &&
                !("synthetic" in part && part.synthetic) &&
                !("ignored" in part && part.ignored),
            )
            .map((part) => `${msg.info.role === "user" ? "User" : "Assistant"}: ${part.text}`),
        )
        .join("\n")
        .slice(-8000)

    // A decision that would need a human is put to the model itself. Any
    // consult failure degrades to the first option, so an autonomous run
    // never blocks and never crashes on a missing provider/agent.
    const consultAnswers = Effect.fn("Question.consultAnswers")(function* (
      sessionID: SessionID,
      questions: ReadonlyArray<Info>,
    ) {
      const fallback = fallbackAnswers(questions)
      const session = yield* sessions.get(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!session) return fallback
      const msgs = yield* sessions.messages({ sessionID, limit: 60 }).pipe(
        Effect.catch(() => Effect.succeed([] as SessionV1.WithParts[])),
      )
      const lastUser = msgs.findLast((msg) => msg.info.role === "user")
      if (!lastUser || lastUser.info.role !== "user") return fallback
      const agent = yield* agents.get(session.agent ?? "build").pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!agent) return fallback
      const model =
        (yield* provider
          .getSmallModel(lastUser.info.model.providerID)
          .pipe(Effect.catch(() => Effect.succeed(undefined)))) ??
        (yield* provider
          .getModel(lastUser.info.model.providerID, lastUser.info.model.modelID)
          .pipe(Effect.catch(() => Effect.succeed(undefined))))
      if (!model) return fallback
      const raw = yield* llm
        .stream({
          agent,
          user: lastUser.info,
          system: [CONSULT_SYSTEM],
          small: true,
          tools: {},
          model,
          sessionID,
          retries: 2,
          messages: [{ role: "user" as const, content: buildConsultPrompt(questions, tailContext(msgs)) }],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
          Effect.timeout("30 seconds"),
          Effect.catch(() => Effect.succeed(undefined)),
        )
      if (raw === undefined) return fallback
      return parseConsult(raw, questions)
    })

    const ask = Effect.fn("Question.ask")(function* (input: {
      sessionID: SessionID
      questions: ReadonlyArray<Info>
      tool?: Tool
    }) {
      if (yield* sessions.effectiveAutonomous(input.sessionID)) {
        const answers = yield* consultAnswers(input.sessionID, input.questions)
        yield* Effect.logInfo("self-answered questions in autonomous session", {
          "session.id": input.sessionID,
          questions: input.questions.length,
        })
        return answers
      }
      const pending = (yield* InstanceState.get(state)).pending
      const id = QuestionID.ascending()
      yield* Effect.logInfo("asking", { id, questions: input.questions.length })

      const deferred = yield* Deferred.make<ReadonlyArray<Answer>, RejectedError>()
      const info: Request = {
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool,
      }
      pending.set(id, { info, deferred })
      yield* events.publish(Event.Asked, info)

      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Question.reply")(function* (input: {
      requestID: QuestionID
      answers: ReadonlyArray<Answer>
    }) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(input.requestID)
      if (!existing) {
        yield* Effect.logWarning("reply for unknown request", { requestID: input.requestID })
        return yield* new NotFoundError({ requestID: input.requestID })
      }
      pending.delete(input.requestID)
      yield* Effect.logInfo("replied", { requestID: input.requestID, answers: input.answers })
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        answers: input.answers.map((a) => [...a]),
      })
      yield* Deferred.succeed(existing.deferred, input.answers)
    })

    const reject = Effect.fn("Question.reject")(function* (requestID: QuestionID) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(requestID)
      if (!existing) {
        yield* Effect.logWarning("reject for unknown request", { requestID })
        return yield* new NotFoundError({ requestID })
      }
      pending.delete(requestID)
      yield* Effect.logInfo("rejected", { requestID })
      yield* events.publish(Event.Rejected, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
      })
      yield* Deferred.fail(existing.deferred, new RejectedError())
    })

    const list = Effect.fn("Question.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (x) => x.info)
    })

    return Service.of({ ask, reply, reject, list })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [EventV2Bridge.node, Session.node, Provider.node, Agent.node, LLM.node],
})

export * as Question from "."
