import { Effect, Stream } from "effect"
import { LLMError, LLMEvent, RateLimitReason } from "@prioricode/llm"
import { ConfigLoop } from "@prioricode/core/config/loop"
import type { Scenario } from "../runner"

const retryable = (message: string) =>
  new LLMError({ module: "eval", method: "stream", reason: new RateLimitReason({ message, retryAfterMs: 5 }) })

const finalTurn = [
  LLMEvent.textStart({ id: "text-recovered" }),
  LLMEvent.textDelta({ id: "text-recovered", text: "Recovered" }),
  LLMEvent.textEnd({ id: "text-recovered" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

export const boundedRecovery: Scenario = {
  name: "retry: bounded retryable provider failures recover with durable notices",
  config: { loop: new ConfigLoop.Info({ retry: new ConfigLoop.Retry({ max_attempts: 3, initial_delay: 1 }) }) },
  main: ({ harness, sessions, sessionID }) =>
    Effect.gen(function* () {
      yield* sessions.prompt({ sessionID, prompt: { text: "Answer after flaky network" }, resume: false })
      harness.turns([finalTurn])
      harness.failNext(retryable("slow down"))
      harness.failNext(retryable("slow down again"))
      yield* sessions.resume(sessionID)
      if (harness.requests < 3)
        return yield* Effect.fail(new Error(`expected three provider attempts, saw ${harness.requests}`))
      const context = yield* sessions.context(sessionID)
      const assistant = context.findLast((message) => message.type === "assistant" && message.finish === "stop")
      if (assistant === undefined) return yield* Effect.fail(new Error("run never recovered to a settled assistant"))
      const events = yield* sessions.events({ sessionID }).pipe(
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk)),
      )
      const retried = events.filter((event) => event.type === "session.next.retried")
      if (retried.length < 2)
        return yield* Effect.fail(new Error(`expected durable retry notices, saw ${retried.length}`))
    }),
}

export const boundedAbort: Scenario = {
  name: "retry: attempts stop at the configured bound and the failure stays visible",
  config: { loop: new ConfigLoop.Info({ retry: new ConfigLoop.Retry({ max_attempts: 2, initial_delay: 1 }) }) },
  main: ({ harness, sessions, sessionID }) =>
    Effect.gen(function* () {
      yield* sessions.prompt({ sessionID, prompt: { text: "Always rate limited" }, resume: false })
      for (let index = 0; index < 6; index++) harness.failNext(retryable(`slow down ${index}`))
      const settled = yield* sessions.resume(sessionID).pipe(Effect.exit)
      if (settled._tag === "Success") return yield* Effect.fail(new Error("run should surface the provider failure"))
      if (harness.requests > 2)
        return yield* Effect.fail(new Error(`exceeded retry bound: ${harness.requests} provider attempts`))
      if (harness.requests < 2)
        return yield* Effect.fail(new Error(`retry bound of two never reached: ${harness.requests}`))
    }),
}

export const scenarios: Scenario[] = [boundedRecovery, boundedAbort]
