import { describe, expect, test } from "bun:test"
import { LLMError, RateLimitReason, InvalidRequestReason, ProviderInternalReason } from "@prioricode/llm"
import { ConfigLoop } from "@prioricode/core/config/loop"
import { ProviderRetry } from "@prioricode/core/session/runner/provider-retry"
import { ToolGuard } from "@prioricode/core/session/runner/tool-guard"

const guardSettings = (overrides: Partial<ToolGuard.Settings> = {}): ToolGuard.Settings => ({
  ...ToolGuard.DEFAULT_SETTINGS,
  readOnlyTools: new Set<string>(),
  ...overrides,
})

describe("ToolGuard.identical calls", () => {
  test("allows first occurrence, warns the repeat, blocks past the threshold", () => {
    const guard = ToolGuard.make(guardSettings({ repeatWarn: 2, repeatBlock: 3, toolCallsPerTurn: 100 }))
    expect(guard.verdict("read", { path: "a.ts" }).type).toBe("allow")
    const warn = guard.verdict("read", { path: "a.ts" })
    expect(warn.type).toBe("warn")
    expect(guard.verdict("read", { path: "a.ts" }).type).toBe("block")
  })

  test("warns only once per distinct call", () => {
    const guard = ToolGuard.make(guardSettings({ repeatWarn: 2, repeatBlock: 5, toolCallsPerTurn: 100 }))
    guard.verdict("read", { path: "a.ts" })
    expect(guard.verdict("read", { path: "a.ts" }).type).toBe("warn")
    expect(guard.verdict("read", { path: "a.ts" }).type).toBe("allow")
  })

  test("distinct arguments do not collide", () => {
    const guard = ToolGuard.make(guardSettings({ repeatWarn: 2, repeatBlock: 3 }))
    expect(guard.verdict("read", { path: "a.ts" }).type).toBe("allow")
    expect(guard.verdict("read", { path: "b.ts" }).type).toBe("allow")
    expect(guard.verdict("read", { path: "a.ts" }).type).toBe("warn")
  })

  test("key order does not affect call identity", () => {
    const guard = ToolGuard.make(guardSettings({ repeatWarn: 2, repeatBlock: 4 }))
    expect(guard.verdict("grep", { pattern: "x", path: "a" }).type).toBe("allow")
    expect(guard.verdict("grep", { path: "a", pattern: "x" }).type).toBe("warn")
  })

  test("read-only tools get a higher block threshold", () => {
    const guard = ToolGuard.make(
      guardSettings({
        readOnlyTools: new Set(["read"]),
        repeatWarn: 2,
        repeatBlock: 2,
        readOnlyRepeatBlock: 4,
        toolCallsPerTurn: 100,
      }),
    )
    expect(guard.verdict("read", { path: "a.ts" }).type).toBe("allow")
    expect(guard.verdict("read", { path: "a.ts" }).type).toBe("warn")
    expect(guard.verdict("read", { path: "a.ts" }).type).toBe("allow")
    expect(guard.verdict("read", { path: "a.ts" }).type).toBe("block")
  })

  test("mutating tools block at the lower threshold", () => {
    const guard = ToolGuard.make(
      guardSettings({ readOnlyTools: new Set(["read"]), repeatWarn: 2, repeatBlock: 3, toolCallsPerTurn: 100 }),
    )
    guard.verdict("write", { path: "a.ts" })
    expect(guard.verdict("write", { path: "a.ts" }).type).toBe("warn")
    expect(guard.verdict("write", { path: "a.ts" }).type).toBe("block")
  })
})

describe("ToolGuard.per-turn bounds", () => {
  test("caps executed local calls within one turn and resets on beginTurn", () => {
    const guard = ToolGuard.make(guardSettings({ toolCallsPerTurn: 2, repeatBlock: 100, repeatWarn: 100 }))
    expect(guard.verdict("read", { path: "a" }).type).toBe("allow")
    expect(guard.verdict("read", { path: "b" }).type).toBe("allow")
    expect(guard.verdict("read", { path: "c" }).type).toBe("block")
    guard.beginTurn()
    expect(guard.verdict("read", { path: "c" }).type).toBe("allow")
  })

  test("blocked calls do not consume the turn budget", () => {
    const guard = ToolGuard.make(guardSettings({ toolCallsPerTurn: 2, repeatBlock: 3, repeatWarn: 3 }))
    guard.verdict("read", { path: "a" })
    guard.verdict("read", { path: "a" })
    guard.verdict("read", { path: "a" }) // blocked, does not count
    guard.beginTurn()
    expect(guard.verdict("read", { path: "b" }).type).toBe("allow")
    expect(guard.verdict("read", { path: "c" }).type).toBe("allow")
    expect(guard.verdict("read", { path: "d" }).type).toBe("block")
  })

  test("output backpressure blocks once the aggregate budget is spent", () => {
    const guard = ToolGuard.make(
      guardSettings({ toolOutputBytesPerTurn: 100, toolCallsPerTurn: 100, repeatBlock: 100, repeatWarn: 100 }),
    )
    expect(guard.verdict("read", { path: "a" }).type).toBe("allow")
    guard.recordOutput(120)
    expect(guard.verdict("read", { path: "b" }).type).toBe("block")
    guard.beginTurn()
    expect(guard.verdict("read", { path: "b" }).type).toBe("allow")
  })

  test("identical history persists across turns", () => {
    const guard = ToolGuard.make(guardSettings({ repeatWarn: 2, repeatBlock: 3, toolCallsPerTurn: 100 }))
    guard.verdict("read", { path: "a" })
    guard.beginTurn()
    expect(guard.verdict("read", { path: "a" }).type).toBe("warn")
  })
})

describe("ToolGuard.settings", () => {
  test("config overrides defaults", () => {
    const settings = ToolGuard.settings(
      new ConfigLoop.Info({
        tool_calls_per_turn: 7,
        repeat_warn: 3,
        repeat_block: 9,
        read_only_tools: ["read"],
      }),
    )
    expect(settings.toolCallsPerTurn).toBe(7)
    expect(settings.repeatWarn).toBe(3)
    expect(settings.repeatBlock).toBe(9)
    expect(settings.readOnlyTools.has("read")).toBe(true)
  })

  test("falls back to defaults without config", () => {
    expect(ToolGuard.settings(undefined)).toEqual(ToolGuard.DEFAULT_SETTINGS)
  })
})

describe("ProviderRetry", () => {
  const rateLimited = new LLMError({
    module: "test",
    method: "stream",
    reason: new RateLimitReason({ message: "slow down", retryAfterMs: 4000 }),
  })
  const serverError = new LLMError({
    module: "test",
    method: "stream",
    reason: new ProviderInternalReason({ message: "overloaded", status: 503 }),
  })
  const invalid = new LLMError({
    module: "test",
    method: "stream",
    reason: new InvalidRequestReason({ message: "bad input" }),
  })

  test("retryable errors before the budget are retried", () => {
    const settings = { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 10_000, jitterFactor: 0 }
    expect(ProviderRetry.shouldRetry(rateLimited, 1, settings)).toBe(true)
    expect(ProviderRetry.shouldRetry(rateLimited, 2, settings)).toBe(true)
    expect(ProviderRetry.shouldRetry(rateLimited, 3, settings)).toBe(false)
  })

  test("non-retryable errors are never retried", () => {
    expect(ProviderRetry.shouldRetry(invalid, 1, ProviderRetry.DEFAULT_SETTINGS)).toBe(false)
    expect(ProviderRetry.shouldRetry(serverError, 1, ProviderRetry.DEFAULT_SETTINGS)).toBe(true)
  })

  test("delay honors provider retry-after and clamps to the max", () => {
    const settings = { maxAttempts: 5, initialDelayMs: 1000, maxDelayMs: 3000, jitterFactor: 0 }
    expect(ProviderRetry.delay(rateLimited, 2, settings, 0)).toBe(3000)
    expect(ProviderRetry.delay(serverError, 2, { ...settings, maxDelayMs: 10_000 }, 0)).toBe(1000)
  })

  test("delay grows exponentially with bounded jitter", () => {
    const settings = { maxAttempts: 5, initialDelayMs: 1000, maxDelayMs: 100_000, jitterFactor: 0.5 }
    expect(ProviderRetry.delay(serverError, 2, settings, 0)).toBe(1000)
    expect(ProviderRetry.delay(serverError, 3, settings, 1)).toBe(3000)
    expect(ProviderRetry.delay(serverError, 4, settings, 1)).toBe(6000)
  })

  test("event error keeps the provider message and tags", () => {
    const event = ProviderRetry.eventError(serverError)
    expect(event.message).toBe("overloaded")
    expect(event.isRetryable).toBe(true)
    expect(event.statusCode).toBe(503)
    expect(event.metadata?.reason).toBe("ProviderInternal")
  })
})
