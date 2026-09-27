import { Effect } from "effect"
import { LLMEvent } from "@prioricode/llm"
import { ConfigVerify } from "@prioricode/core/config/verify"
import type { Scenario } from "../runner"

const brokenEditTurn = [
  LLMEvent.toolInputStart({ id: "call-write", name: "write" }),
  LLMEvent.toolInputDelta({ id: "call-write", name: "write", text: JSON.stringify({ path: "index.ts" }) }),
  LLMEvent.toolInputEnd({ id: "call-write", name: "write" }),
  LLMEvent.toolCall({ id: "call-write", name: "write", input: { path: "index.ts" } }),
  LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
  LLMEvent.finish({ reason: "tool-calls" }),
]

const finalTurn = [
  LLMEvent.textStart({ id: "text-final" }),
  LLMEvent.textDelta({ id: "text-final", text: "Fixed the seeded failure" }),
  LLMEvent.textEnd({ id: "text-final" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

export const verifyCatchesBrokenEdits: Scenario = {
  name: "verify: failing check feeds a durable steering prompt back before completion",
  config: { verify: new ConfigVerify.Info({ command: "exit 1" }) },
  main: ({ harness, sessions, sessionID }) =>
    Effect.gen(function* () {
      yield* sessions.prompt({ sessionID, prompt: { text: "Write the file" }, resume: false })
      harness.turns([brokenEditTurn, finalTurn])
      yield* sessions.resume(sessionID)
      if (harness.requests < 2)
        return yield* Effect.fail(new Error(`verification never continued the drain (${harness.requests} turns)`))
      const context = yield* sessions.context(sessionID)
      const sawFailure = context.some(
        (message) => message.type === "user" && message.text.includes("Automatic verification before completion failed"),
      )
      if (!sawFailure) return yield* Effect.fail(new Error("verification steering prompt never reached the model"))
      const assistant = context.findLast((message) => message.type === "assistant" && message.finish === "stop")
      if (assistant === undefined) return yield* Effect.fail(new Error("session never settled after verification"))
    }),
}

export const scenarios: Scenario[] = [verifyCatchesBrokenEdits]
