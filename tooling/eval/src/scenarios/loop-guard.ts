import { Cause, Effect } from "effect"
import { LLMEvent } from "@prioricode/llm"
import { ConfigLoop } from "@prioricode/core/config/loop"
import { SessionInput } from "@prioricode/core/session/input"
import type { Scenario } from "../runner"

const repeatedCalls = toolEvents([
  ["call-repeat-1", "echo", { text: "again" }],
  ["call-repeat-2", "echo", { text: "again" }],
  ["call-repeat-3", "echo", { text: "again" }],
])

function toolEvents(calls: Array<[string, string, unknown]>): LLMEvent[] {
  return [
    ...calls.flatMap(([id, name, input]) => [
      LLMEvent.toolInputStart({ id, name }),
      LLMEvent.toolInputDelta({ id, name, text: JSON.stringify(input) }),
      LLMEvent.toolInputEnd({ id, name }),
      LLMEvent.toolCall({ id, name, input }),
    ]),
    LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
    LLMEvent.finish({ reason: "tool-calls" }),
  ]
}

const closingTurn = [
  LLMEvent.textStart({ id: "text-done" }),
  LLMEvent.textDelta({ id: "text-done", text: "Moved on" }),
  LLMEvent.textEnd({ id: "text-done" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

export const loopGuard: Scenario = {
  name: "loop-guard: identical tool calls warn once then block",
  config: { loop: new ConfigLoop.Info({ repeat_warn: 2, repeat_block: 3 }) },
  main: ({ harness, sessions, sessionID }) =>
    Effect.gen(function* () {
      yield* sessions.prompt({ sessionID, prompt: { text: "Echo forever" }, resume: false })
      harness.turns([repeatedCalls, closingTurn])
      yield* sessions.resume(sessionID)
      if (harness.requests < 2)
        return yield* Effect.fail(new Error(`expected at least two provider turns, saw ${harness.requests}`))
      const context = yield* sessions.context(sessionID)
      const settled = context.findLast((message) => message.type === "assistant" && message.finish === "stop")
      if (settled === undefined) return yield* Effect.fail(new Error("assistant never settled with stop"))
      const caller = context.find(
        (message) =>
          message.type === "assistant" &&
          message.content.some((content) => content.type === "tool" && content.id === "call-repeat-3"),
      )
      if (caller === undefined || caller.type !== "assistant")
        return yield* Effect.fail(new Error("third identical call never settled"))
      const blocked = caller.content.find((content) => content.type === "tool" && content.id === "call-repeat-3")
      if (blocked === undefined || blocked.type !== "tool" || blocked.state.status !== "error")
        return yield* Effect.fail(new Error("third identical call was not blocked"))
      if (!JSON.stringify(blocked.state.error).includes("TOOL CALL BLOCKED"))
        return yield* Effect.fail(new Error("blocked call is missing the guard message"))
    }),
}

export const toolCallCap: Scenario = {
  name: "loop-guard: per-turn tool-call cap holds further calls",
  config: { loop: new ConfigLoop.Info({ tool_calls_per_turn: 2 }) },
  main: ({ harness, sessions, sessionID }) =>
    Effect.gen(function* () {
      yield* sessions.prompt({ sessionID, prompt: { text: "Five echoes" }, resume: false })
      harness.turns([
        toolEvents([
          ["c1", "echo", { text: "1" }],
          ["c2", "echo", { text: "2" }],
          ["c3", "echo", { text: "3" }],
          ["c4", "echo", { text: "4" }],
        ]),
        closingTurn,
      ])
      yield* sessions.resume(sessionID)
      const context = yield* sessions.context(sessionID)
      const assistant = context.findLast(
        (message) =>
          message.type === "assistant" &&
          message.content.some((content) => content.type === "tool" && content.id === "c4"),
      )
      if (assistant === undefined || assistant.type !== "assistant")
        return yield* Effect.fail(new Error("fourth call never settled"))
      const fourth = assistant.content.find((content) => content.type === "tool" && content.id === "c4")
      if (fourth === undefined || fourth.type !== "tool" || fourth.state.status !== "error")
        return yield* Effect.fail(new Error("call beyond the cap was not held back"))
    }),
}

export const scenarios: Scenario[] = [loopGuard, toolCallCap]

void Cause
void SessionInput
