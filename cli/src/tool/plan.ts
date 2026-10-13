import path from "path"
import { SessionV1 } from "@prioricode/core/v1/session"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID, SessionID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"

export const Parameters = Schema.Struct({})

function injectSyntheticSwitch(
  session: Session.Interface,
  provider: Provider.Interface,
  sessionID: SessionID,
  agent: "plan" | "build",
  text: string,
) {
  return Effect.gen(function* () {
    const messages = yield* session.messages({ sessionID }).pipe(Effect.orDie)
    const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
    const model =
      lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()

    const msg: SessionV1.User = {
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent,
      model,
    }
    yield* session.updateMessage(msg)
    yield* session.updatePart({
      id: PartID.ascending(),
      messageID: msg.id,
      sessionID,
      type: "text",
      text,
      synthetic: true,
    } satisfies SessionV1.TextPart)
  }).pipe(Effect.orDie)
}

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(instance.worktree, Session.plan(info, instance))
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `Plan at ${plan} is complete. Would you like to switch to the build agent and start implementing?`,
                header: "Build Agent",
                custom: false,
                options: [
                  { label: "Yes", description: "Switch to build agent and start implementing the plan" },
                  { label: "No", description: "Stay with plan agent to continue refining the plan" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] === "No") yield* new Question.RejectedError()

          yield* injectSyntheticSwitch(
            session,
            provider,
            ctx.sessionID,
            "build",
            `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
          )

          return {
            title: "Switching to build agent",
            output: "User approved switching to build agent. Wait for further instructions.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const PlanEnterTool = Tool.define(
  "plan_enter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: ENTER_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: "This task would benefit from planning before implementation. Switch to plan agent?",
                header: "Plan Agent",
                custom: false,
                options: [
                  { label: "Yes", description: "Switch to plan agent to research and create a plan" },
                  { label: "No", description: "Continue with build agent and implement directly" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] === "No") yield* new Question.RejectedError()

          yield* injectSyntheticSwitch(
            session,
            provider,
            ctx.sessionID,
            "plan",
            "Switch to plan mode. Analyze the request and create a plan.",
          )

          return {
            title: "Switching to plan agent",
            output: "User approved switching to plan agent. Wait for further instructions.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
