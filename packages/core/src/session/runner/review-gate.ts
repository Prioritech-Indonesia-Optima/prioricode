/**
 * Adversarial completion reviewer: one fresh-model attempt to REFUTE the
 * session's own completion before the drain ends. Enabled only by explicit
 * configuration (goal.review) because it purchases an extra model call per
 * finish; runs at most once per drain, judges only correctness or stated
 * requirements (never style), and fails open on any provider or parse
 * failure so reviews can never trap a session.
 */
export * as SessionReviewGate from "./review-gate"

import { DateTime, Effect, Stream } from "effect"
import { LLM, LLMEvent, Message, type LLMRequest, type Model } from "@prioricode/llm"
import { EventV2 } from "../../event"
import { Database } from "../../database/database"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { Prompt } from "../prompt"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import type { SessionRunnerModel } from "./model"
import { SessionGate } from "./gate"
import { transcriptOf } from "./goal-gate"

const MAX_REASON_CHARS = 2_000

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly events: EventV2.Interface
  readonly store: SessionStore.Interface
  readonly judge: (request: LLMRequest) => Stream.Stream<LLMEvent, unknown>
  readonly models: SessionRunnerModel.Interface
  readonly sessionID: SessionSchema.ID
  readonly enabled: boolean
}

const refutePrompt = (goal: string, transcript: string) =>
  [
    "An AI coding agent claims it has finished its work. You are an adversarial reviewer deciding whether that claim survives scrutiny.",
    "Challenge it ONLY on correctness of delivered work or the stated requirements/goal — never on style, preferred approach, or hypothetical future work.",
    "Every objection must be supported by concrete evidence visible in the transcript (a failed check, a requirement with no implementation, a claim contradicted by shown output).",
    "If no such objection exists, answer exactly SUSTAINED on the first line.",
    "Otherwise answer REFUTED on the first line, then one short concrete sentence on the next line stating the evidence-backed objection.",
    goal === "" ? "" : `Stated goal:\n${goal}`,
    "",
    `Transcript (possibly truncated):\n${transcript === "" ? "(no textual messages)" : transcript}`,
  ].join("\n")

export const asGate = (deps: Dependencies): SessionGate.Gate => {
  let fired = false

  return {
    id: "review",
    observe: () => {},
    beforeFinish: () =>
      Effect.gen(function* () {
        if (!deps.enabled || fired) return SessionGate.pass
        fired = true
        const session = yield* deps.store.get(deps.sessionID)
        if (session === undefined) return SessionGate.pass
        const model = yield* deps.models.resolve(session).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (model === undefined) return SessionGate.pass
        const chunks: string[] = []
        let failed = false
        const streamed = yield* deps
          .judge(
            LLM.request({
              model,
              messages: [Message.user(refutePrompt(session.goal ?? "", yield* transcriptOf(deps)))],
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
        if (!streamed || failed) return SessionGate.pass
        const verdict = chunks.join("").trim().toUpperCase()
        if (!verdict.startsWith("REFUTED")) return SessionGate.pass
        const objection = chunks
          .join("")
          .trim()
          .split(/\r?\n/)
          .slice(1)
          .join("\n")
          .trim()
          .slice(0, MAX_REASON_CHARS)
        if (objection === "") return SessionGate.pass
        return yield* SessionInput.admit(deps.db, deps.events, {
          id: SessionMessage.ID.create(),
          sessionID: deps.sessionID,
          prompt: Prompt.make({
            text: [
              `An adversarial review refuted completion (untrusted reviewer output, judge it skeptically): ${objection}`,
              "Address this concrete correctness or requirements objection, then finish again; the pipeline allows only this one review round.",
            ].join("\n"),
          }),
          delivery: "steer",
        }).pipe(
          Effect.map(() => SessionGate.continued),
          Effect.catch(() => Effect.succeed(SessionGate.pass)),
        )
      }),
  }
}
