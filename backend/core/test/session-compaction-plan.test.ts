import { describe, expect, it } from "bun:test"
import { Model } from "@prioricode/llm"
import * as OpenAIChat from "@prioricode/llm/protocols/openai-chat"
import { DateTime } from "effect"
import { ModelV2 } from "@prioricode/core/model"
import { ProviderV2 } from "@prioricode/core/provider"
import { SessionCompaction, type Entry, type Settings } from "@prioricode/core/session/compaction"
import { SessionMessage } from "@prioricode/core/session/message"
import { Token } from "@prioricode/core/util/token"

const makeSettings = (overrides?: Partial<Settings>): Settings => ({
  auto: true,
  buffer: 20_000,
  tokens: 8_000,
  turns: undefined,
  threshold: undefined,
  defaultContext: 128_000,
  ...overrides,
})

const now = DateTime.makeUnsafe(0)

const user = (seq: number, text: string): Entry => ({
  seq,
  message: {
    id: SessionMessage.ID.create(),
    type: "user",
    text,
    time: { created: now },
  } as SessionMessage.Message,
})

const assistant = (seq: number, text: string): Entry => ({
  seq,
  message: {
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: "build",
    model: { id: ModelV2.ID.make("m"), providerID: ProviderV2.ID.make("p") },
    content: [{ type: "text", id: "t", text }],
    time: { created: now },
  } as SessionMessage.Message,
})

const modelWith = (context?: number, output?: number) =>
  Model.make({
    id: "fake-model",
    provider: "fake",
    route: context === undefined ? OpenAIChat.route : OpenAIChat.route.with({ limits: { context, output } }),
  })

describe("SessionCompaction.resolveContext", () => {
  it("uses the model-declared window", () => {
    expect(SessionCompaction.resolveContext(modelWith(32_000, 4_096), 128_000)).toEqual({
      context: 32_000,
      source: "model",
      declared: 32_000,
    })
  })

  it("falls back to the configured default when the model declares none", () => {
    expect(SessionCompaction.resolveContext(modelWith(), 50_000)).toEqual({
      context: 50_000,
      source: "default",
      declared: undefined,
    })
  })

  it("treats a zero declared window as undeclared", () => {
    expect(SessionCompaction.resolveContext(modelWith(0, 4_096), 50_000)).toEqual({
      context: 50_000,
      source: "default",
      declared: 0,
    })
  })
})

describe("SessionCompaction.plan", () => {
  it("returns undefined when there is nothing to compact", () => {
    expect(SessionCompaction.plan([], makeSettings(), undefined, "", 128_000, 4_096)).toBeUndefined()
  })

  it("keeps a verbatim tail even when the newest message exceeds the token budget", () => {
    const entries = [user(1, "a".repeat(4_000)), user(2, "b".repeat(40_000))]
    const planned = SessionCompaction.plan(entries, makeSettings(), undefined, "", 128_000, 4_096)
    expect(planned).toBeDefined()
    if (planned === undefined || planned.fallback === "window-too-small") throw new Error("unexpected plan")
    expect(planned.hardTruncated).toBe(true)
    expect(planned.recent.length).toBeGreaterThan(0)
    expect(Token.estimate(planned.recent)).toBeLessThanOrEqual(8_000 + 16)
    expect(planned.head).toContain("a".repeat(4_000))
  })

  it("splits head and recent by the token budget", () => {
    const entries = Array.from({ length: 10 }, (_, i) => user(i + 1, `m${i + 1}`.repeat(2_000)))
    const planned = SessionCompaction.plan(entries, makeSettings(), undefined, "", 128_000, 4_096)
    if (planned === undefined || planned.fallback === "window-too-small") throw new Error("unexpected plan")
    expect(planned.fallback).toBe("none")
    expect(planned.head).not.toBe("")
    expect(planned.recent).not.toBe("")
    expect(planned.head).toContain("m1".repeat(2_000))
    expect(planned.recent).toContain("m10".repeat(2_000))
    expect(planned.head).not.toContain("m10".repeat(2_000))
    expect(planned.recent).not.toContain("m1".repeat(2_000))
  })

  it("caps the retained tail at the configured turn count", () => {
    const entries = [
      user(1, "u1"),
      assistant(2, "a1"),
      user(3, "u2"),
      assistant(4, "a2"),
      user(5, "u3"),
      assistant(6, "a3"),
      user(7, "u4"),
      assistant(8, "a4"),
    ]
    const planned = SessionCompaction.plan(
      entries,
      makeSettings({ turns: 2, tokens: 100_000 }),
      undefined,
      "",
      128_000,
      4_096,
    )
    if (planned === undefined || planned.fallback === "window-too-small") throw new Error("unexpected plan")
    expect(planned.recent).toContain("u3")
    expect(planned.recent).toContain("u4")
    expect(planned.recent).not.toContain("u2")
    expect(planned.recent).not.toContain("a2")
    expect(planned.head).toContain("u2")
    expect(planned.head).toContain("a2")
  })

  it("progressively drops the oldest head messages when the summary prompt overflows", () => {
    const entries = Array.from({ length: 8 }, (_, i) => user(i + 1, `m${i + 1}`.repeat(8_000)))
    const planned = SessionCompaction.plan(entries, makeSettings(), undefined, "", 20_000, 4_096)
    if (planned === undefined || planned.fallback === "window-too-small") throw new Error("unexpected plan")
    expect(planned.fallback).toBe("progressive")
    expect(planned.droppedTokens).toBeGreaterThanOrEqual(8_000)
    expect(planned.head).toContain("m7".repeat(8_000))
    expect(planned.head).not.toContain("m1".repeat(8_000))
    expect(planned.recent).toContain("m8".repeat(8_000))
  })

  it("truncates the prior recent tail when the head is exhausted", () => {
    const entries = [user(1, "new".repeat(100))]
    const planned = SessionCompaction.plan(entries, makeSettings(), undefined, "p".repeat(100_000), 20_000, 4_096)
    if (planned === undefined || planned.fallback === "window-too-small") throw new Error("unexpected plan")
    expect(planned.truncatedPriorRecent).toBe(true)
    expect(planned.fallback).toBe("progressive")
    expect(planned.priorRecent.length).toBeLessThan(100_000)
  })

  it("hard-truncates the prior summary as a last resort", () => {
    const entries = [user(1, "new".repeat(100))]
    const planned = SessionCompaction.plan(entries, makeSettings(), "s".repeat(100_000), "", 20_000, 4_096)
    if (planned === undefined || planned.fallback === "window-too-small") throw new Error("unexpected plan")
    expect(planned.hardTruncated).toBe(true)
    expect(planned.fallback).toBe("hard-truncation")
    expect(planned.priorSummary).toBeDefined()
    expect(planned.priorSummary!.length).toBeLessThan(100_000)
  })

  it("reports window-too-small when the window cannot hold a summary", () => {
    const entries = [user(1, "hello")]
    expect(SessionCompaction.plan(entries, makeSettings(), undefined, "", 4_000, 4_096)).toEqual({
      fallback: "window-too-small",
    })
  })

  it("caps the verbatim tail to the model window", () => {
    const entries = [user(1, "a".repeat(4_000)), user(2, "b".repeat(100_000))]
    const planned = SessionCompaction.plan(entries, makeSettings(), undefined, "", 12_000, 4_096)
    if (planned === undefined || planned.fallback === "window-too-small") throw new Error("unexpected plan")
    expect(planned.hardTruncated).toBe(true)
    expect(planned.recent.length).toBeGreaterThan(0)
    expect(Token.estimate(planned.recent)).toBeLessThanOrEqual(8_000)
  })

  it("honors an explicit head cut anchor", () => {
    const entries = Array.from({ length: 5 }, (_, i) => user(i + 1, `m${i + 1}`.repeat(100)))
    const planned = SessionCompaction.plan(entries, makeSettings(), undefined, "", 128_000, 4_096, 3)
    if (planned === undefined || planned.fallback === "window-too-small") throw new Error("unexpected plan")
    expect(planned.head).toContain("m3".repeat(100))
    expect(planned.head).not.toContain("m4".repeat(100))
    expect(planned.recent).toContain("m4".repeat(100))
    expect(planned.recent).toContain("m5".repeat(100))
  })

  it("clamps the anchor so at least one message stays verbatim", () => {
    const entries = Array.from({ length: 5 }, (_, i) => user(i + 1, `m${i + 1}`.repeat(100)))
    const planned = SessionCompaction.plan(entries, makeSettings(), undefined, "", 128_000, 4_096, 5)
    if (planned === undefined || planned.fallback === "window-too-small") throw new Error("unexpected plan")
    expect(planned.recent).toContain("m5".repeat(100))
    expect(planned.head).toContain("m4".repeat(100))
  })

  it("terminates on pathological input", () => {
    const entries = Array.from({ length: 50 }, (_, i) => user(i + 1, "z".repeat(100_000)))
    const planned = SessionCompaction.plan(
      entries,
      makeSettings(),
      "s".repeat(100_000),
      "p".repeat(100_000),
      20_000,
      4_096,
    )
    expect(planned).toBeDefined()
    if (planned !== undefined && planned.fallback !== "window-too-small") {
      expect(planned.fallback).toBe("hard-truncation")
    }
  })
})
