/**
 * Durable-goal finish gate. Consulted only when a drain would otherwise end
 * and only while the session carries a goal. `command` mode reruns the
 * configured check; `llm` mode asks the session model for a DONE / NOT_DONE
 * verdict against the transcript. A "met" verdict clears the goal and admits
 * nothing; an "unmet" verdict admits exactly one steering prompt.
 * Re-evaluation is skipped when no tool settled since the previous verdict —
 * the transcript has not changed, so the same answer would be repurchased.
 * Every failure mode (missing model output, provider error, unparsable
 * verdict, exhausted attempts) fails OPEN so users can always end a session.
 */
export * as SessionGoalGate from "./goal-gate"

import { DateTime, Duration, Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { LLM, LLMEvent, Message, type LLMRequest, type Model } from "@prioricode/llm"
import { EventV2 } from "../../event"
import { Database } from "../../database/database"
import { AppProcess } from "../../process"
import type { ConfigGoal } from "../../config/goal"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { Prompt } from "../prompt"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import type { SessionRunnerModel } from "./model"
import { SessionGate } from "./gate"

const DEFAULT_MAX_ATTEMPTS = 2
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 120
const MAX_TRANSCRIPT_CHARS = 24_000
const MAX_REASON_CHARS = 2_000
const MAX_OUTPUT_CHARS = 4_000

type Verdict = { readonly done: boolean; readonly reason: string }

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly events: EventV2.Interface
  readonly store: SessionStore.Interface
  readonly process: AppProcess.Interface
  readonly judge: (request: LLMRequest) => Stream.Stream<LLMEvent, unknown>
  readonly models: SessionRunnerModel.Interface
  readonly directory: string
  readonly sessionID: SessionSchema.ID
  readonly config: ConfigGoal.Info | undefined
}

const judgePrompt = (goal: string, transcript: string) =>
  [
    "You are a completion judge for an AI coding session. The session has a durable goal.",
    "Decide whether every requirement of the goal — including any 'Done when:' clause — has been verifiably met by the work shown in the transcript.",
    "Judge only the transcript evidence against the goal; do not invent requirements.",
    "Answer with exactly DONE on one line, or NOT_DONE on the first line followed by one short concrete sentence on the next line describing what is still missing.",
    "",
    `Goal:\n${goal}`,
    "",
    `Transcript (possibly truncated):\n${transcript === "" ? "(no textual messages)" : transcript}`,
  ].join("\n")

const parseVerdict = (text: string): Verdict | undefined => {
  const trimmed = text.trim()
  if (trimmed === "") return undefined
  const head = trimmed.toUpperCase().replace(/[.!]+$/g, "")
  if (head === "DONE" || head.startsWith("DONE\n") || head.startsWith("DONE ")) return { done: true, reason: "" }
  if (head.startsWith("NOT_DONE") || head.startsWith("NOT DONE")) {
    const rest = trimmed.split(/\r?\n/).slice(1).join("\n").trim()
    return {
      done: false,
      reason: rest === "" ? "The judge found the goal requirements not yet met." : rest.slice(0, MAX_REASON_CHARS),
    }
  }
  return undefined
}

export const transcriptOf = (deps: Pick<Dependencies, "db" | "sessionID">) =>
  Effect.gen(function* () {
    const entries = yield* SessionHistory.entriesForRunner(deps.db, deps.sessionID, 0).pipe(
      Effect.catch(() => Effect.succeed([])),
    )
    const text = entries
      .map((entry) => entry.message)
      .flatMap((message) => {
        if (message.type === "user") return [`user: ${message.text}`]
        if (message.type === "assistant")
          return message.content.flatMap((part) =>
            part.type === "text" && part.text !== "" ? [`assistant: ${part.text}`] : [],
          )
        return []
      })
      .join("\n\n")
    return text.length <= MAX_TRANSCRIPT_CHARS ? text : text.slice(text.length - MAX_TRANSCRIPT_CHARS)
  })

const evaluateJudge = (deps: Dependencies, goal: string, model: Model) =>
  Effect.gen(function* () {
    const text = yield* transcriptOf(deps)
    const chunks: string[] = []
    let failed = false
    const streamed = yield* deps
      .judge(
        LLM.request({
          model,
          messages: [Message.user(judgePrompt(goal, text))],
          tools: [],
          generation: { maxTokens: 220 },
        }),
      )
      .pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          return Effect.void
        }),
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      )
    if (!streamed || failed) return undefined
    return parseVerdict(chunks.join(""))
  })

const runCheck = (deps: Dependencies, command: string) =>
  deps.process
    .run(
      ChildProcess.make(command, [], {
        cwd: deps.directory,
        shell: process.platform === "win32" ? true : "/bin/sh",
        stdin: "ignore",
        detached: process.platform !== "win32",
        forceKillAfter: Duration.seconds(3),
      }),
      {
        combineOutput: true,
        timeout: Duration.seconds(deps.config?.timeout ?? DEFAULT_COMMAND_TIMEOUT_SECONDS),
        maxOutputBytes: 64_000,
      },
    )
    .pipe(Effect.catch(() => Effect.void))

export const asGate = (deps: Dependencies): SessionGate.Gate => {
  const limit = deps.config?.max_attempts ?? DEFAULT_MAX_ATTEMPTS
  let attempts = 0
  let mutations = 0
  let cached: { readonly mutations: number; readonly verdict: Verdict | undefined } | undefined

  const steer = (text: string) =>
    SessionInput.admit(deps.db, deps.events, {
      id: SessionMessage.ID.create(),
      sessionID: deps.sessionID,
      prompt: Prompt.make({ text }),
      delivery: "steer",
    }).pipe(
      Effect.map(() => SessionGate.continued),
      Effect.catch(() => Effect.succeed(SessionGate.pass)),
    )

  const goalSteer = (reason: string, goal: string) =>
    steer(
      [
        `The durable session goal is not met yet: ${reason}`,
        "Continue working toward the goal; finish only when the work truly satisfies it.",
        "Goal:",
        goal,
      ].join("\n"),
    )

  const clearGoal = Effect.gen(function* () {
    yield* deps.events
      .publish(SessionEvent.GoalSet, {
        sessionID: deps.sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        goal: "",
      })
      .pipe(Effect.catch(() => Effect.void))
  })

  return {
    id: "goal",
    observe: () => {
      mutations += 1
    },
    beforeFinish: () =>
      Effect.gen(function* () {
        const session = yield* deps.store.get(deps.sessionID)
        const goal = session?.goal ?? ""
        if (session === undefined || goal === "" || deps.config?.check === "off") return SessionGate.pass
        if (attempts >= limit) return SessionGate.pass
        const mode = deps.config?.check ?? (deps.config?.command !== undefined ? "command" : "llm")
        if (mode === "command") {
          const command = deps.config?.command
          if (command === undefined) return SessionGate.pass
          const result = yield* runCheck(deps, command)
          if (result === undefined) return SessionGate.pass
          if (result.exitCode === 0) {
            yield* clearGoal
            return SessionGate.pass
          }
          attempts += 1
          return yield* steer(
            [
              `The durable session goal is not met yet: the check command \`${command}\` exited ${result.exitCode}.`,
              "Fix the work so the goal (including its Done when clause) is genuinely satisfied, then finish. Do not fake or skip the check.",
              "Goal:",
              goal,
              "Output:",
              "```",
              (result.output?.toString("utf8") ?? "").slice(-MAX_OUTPUT_CHARS),
              "```",
            ].join("\n"),
          )
        }
        if (cached !== undefined && cached.mutations === mutations) {
          if (cached.verdict === undefined || cached.verdict.done) return SessionGate.pass
          attempts += 1
          if (attempts > limit) return SessionGate.pass
          return yield* goalSteer(cached.verdict.reason, goal)
        }
        const sessionModel = yield* deps.models.resolve(session).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (sessionModel === undefined) return SessionGate.pass
        const verdict = yield* evaluateJudge(deps, goal, sessionModel)
        cached = { mutations, verdict }
        if (verdict === undefined) return SessionGate.pass
        if (verdict.done) {
          yield* clearGoal
          return SessionGate.pass
        }
        attempts += 1
        return yield* goalSteer(verdict.reason, goal)
      }),
  }
}
