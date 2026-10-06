import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Part, Provider, Session } from "@prioricode/sdk/v2"
import {
  completedToolCount,
  computeUsage,
  estimateStreamingTokens,
  formatTurnHud,
  runningTool,
} from "../../src/util/context-usage"

const assistant = (overrides: Partial<AssistantMessage> = {}): AssistantMessage =>
  ({
    role: "assistant",
    providerID: "acme",
    modelID: "model-1",
    tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  }) as unknown as AssistantMessage

const providers: Provider[] = [
  {
    id: "acme",
    models: { "model-1": { limit: { context: 10000 } } },
  } as unknown as Provider,
]

describe("computeUsage", () => {
  test("returns undefined without a completed-output assistant message", () => {
    const messages = [{ role: "user" }] as unknown as Message[]
    expect(computeUsage({ session: undefined, messages, providers })).toBeUndefined()
    expect(computeUsage({ session: undefined, messages: [], providers })).toBeUndefined()
  })

  test("computes tokens, percent, context and cost from the last completed message", () => {
    const messages = [
      assistant(),
      assistant({ tokens: { input: 2000, output: 1000, reasoning: 0, cache: { read: 0, write: 0 } } as never }),
    ] as unknown as Message[]
    const usage = computeUsage({
      session: { cost: 1.4 } as unknown as Session,
      messages,
      providers,
    })
    expect(usage?.tokens).toBe(3000)
    expect(usage?.percent).toBe(30)
    expect(usage?.context).toBe("3.0K (30%)")
    expect(usage?.cost).toBe("$1.40")
  })

  test("omits percent for unknown models and cost when zero", () => {
    const usage = computeUsage({
      session: { cost: 0 } as unknown as Session,
      messages: [assistant()] as unknown as Message[],
      providers: [],
    })
    expect(usage?.context).toBe("1.5K")
    expect(usage?.percent).toBeUndefined()
    expect(usage?.cost).toBeUndefined()
  })
})

const textPart = (text: string): Part => ({ type: "text", text }) as Part
const toolPart = (tool: string, status: string, title?: string): Part =>
  ({ type: "tool", tool, callID: `call-${tool}-${status}`, state: { status, ...(title ? { title } : {}) } }) as Part

describe("estimateStreamingTokens", () => {
  test("sums text and reasoning length, quantized to hundreds", () => {
    expect(
      estimateStreamingTokens([textPart("a".repeat(400)), { type: "reasoning", text: "b".repeat(420) } as Part]),
    ).toBe(200)
  })

  test("ignores synthetic and ignored parts", () => {
    expect(estimateStreamingTokens([{ type: "text", text: "x".repeat(4000), synthetic: true } as Part])).toBe(0)
    expect(estimateStreamingTokens([{ type: "text", text: "x".repeat(4000), ignored: true } as Part])).toBe(0)
  })

  test("empty parts estimate zero", () => {
    expect(estimateStreamingTokens([])).toBe(0)
  })
})

describe("runningTool / completedToolCount", () => {
  test("picks the last running tool", () => {
    const parts = [
      toolPart("read", "completed"),
      toolPart("bash", "running", "ls"),
      toolPart("edit", "running", "src/a.ts"),
    ]
    expect(runningTool(parts)).toEqual({ tool: "edit", title: "src/a.ts" })
  })

  test("undefined when nothing runs", () => {
    expect(runningTool([toolPart("read", "completed"), toolPart("glob", "pending")])).toBeUndefined()
  })

  test("counts completed and errored tools", () => {
    expect(
      completedToolCount([toolPart("read", "completed"), toolPart("bash", "error"), toolPart("edit", "running")]),
    ).toBe(2)
  })
})

describe("formatTurnHud", () => {
  test("joins available segments only", () => {
    expect(
      formatTurnHud({ tool: { tool: "edit", title: "src/a.ts" }, done: 3, estimate: 2100, elapsedMs: 45000 }),
    ).toBe("src/a.ts · 3 tools · 45.0s · ~2.1K tok")
    expect(formatTurnHud({ done: 0, estimate: 0, elapsedMs: 1200 })).toBe("1.2s")
    expect(formatTurnHud({ tool: { tool: "websearch" }, done: 0, estimate: 0, elapsedMs: 500 })).toBe(
      "Websearch · 500ms",
    )
  })
})
