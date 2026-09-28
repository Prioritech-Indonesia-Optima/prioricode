import { describe, expect, test } from "bun:test"
import { Message } from "@prioricode/llm"
import { SessionPrune } from "@prioricode/core/session/runner/prune"

const big = (character: string, times: number) => character.repeat(times)
const options = { pressure: true, keepRecentSteps: 1, minBytes: 1_000 }
const noPressure = { ...options, pressure: false }

const toolResult = (id: string, name: string, value: string, providerExecuted = false) =>
  Message.tool({
    id,
    name,
    result: { type: "text", value },
    ...(providerExecuted ? { providerExecuted: true } : {}),
  })
const assistantWithCall = (marker: string) =>
  Message.make({
    id: "asst-" + marker,
    role: "assistant",
    content: [
      { type: "tool-call", id: "call-" + marker, name: "read", input: {} },
      { type: "text", text: "thinking " + marker },
    ],
  })

const history = () => [
  Message.user("start"),
  assistantWithCall("a"),
  toolResult("call-a", "read", big("x", 2_000)),
  assistantWithCall("b"),
  toolResult("call-b", "read", big("y", 2_000)),
  assistantWithCall("c"),
  toolResult("call-c", "read", big("z", 2_000)),
  Message.user("continue"),
  toolResult("call-small", "grep", "tiny output"),
  toolResult("call-executed", "bash", big("w", 2_000), true),
]

describe("session prune projection", () => {
  const run = SessionPrune.projectForRequest

  test("below pressure the array is returned verbatim", () => {
    const messages = history()
    expect(run(messages, noPressure)).toBe(messages)
  })

  test("only large local results outside the recent window are elided", () => {
    const projected = run(history(), options)
    const text = (index: number) => JSON.stringify(projected[index])
    expect(text(2)).toContain("tool output pruned")
    expect(text(4)).toContain("tool output pruned")
    expect(text(6)).not.toContain("tool output pruned") // last assistant step stays intact
    expect(text(8)).not.toContain("tool output pruned") // below minBytes
    expect(text(9)).not.toContain("tool output pruned") // provider-executed stays verbatim
    expect(text(0)).toContain("start")
    expect(text(7)).toContain("continue")
  })

  test("pairing survives: every result keeps its id and count", () => {
    const projected = run(history(), options)
    const ids = projected
      .flatMap((message) =>
        message.role === "tool"
          ? message.content.flatMap((part) => (part.type === "tool-result" ? [part.id] : []))
          : [],
      )
      .sort()
    expect(ids).toEqual(["call-a", "call-b", "call-c", "call-executed", "call-small"])
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("determinism: identical inputs project identically", () => {
    const first = JSON.stringify(run(history(), options))
    const second = JSON.stringify(run(history(), options))
    expect(first).toBe(second)
    expect(first.match(/tool output pruned — \d+ bytes elided/g)).toHaveLength(2)
  })

  test("monotone: growing the conversation never un-prunes an earlier result", () => {
    const short = run(history(), options)
    const grown = run(
      [...history(), assistantWithCall("d"), toolResult("call-d", "read", big("v", 2_000))],
      options,
    )
    const prunedIndex = short.findIndex((message) => JSON.stringify(message).includes("tool output pruned"))
    expect(prunedIndex).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(grown[prunedIndex])).toContain("tool output pruned")
    expect(JSON.stringify(grown[prunedIndex])).toBe(JSON.stringify(short[prunedIndex]))
  })

  test("elided byte count approximates the original projected size", () => {
    const projected = run(
      [toolResult("call-old", "read", big("q", 2_000)), assistantWithCall("e"), assistantWithCall("f"), assistantWithCall("g")],
      options,
    )
    const match = JSON.stringify(projected[0]).match(/tool output pruned — (\d+) bytes elided/)
    expect(match).not.toBeNull()
    const elided = Number(match![1])
    const resultBytes = Buffer.byteLength(JSON.stringify({ type: "text", value: big("q", 2_000) }), "utf8")
    expect(elided).toBeGreaterThan(resultBytes - 120)
    expect(elided).toBeLessThan(resultBytes)
  })
})
