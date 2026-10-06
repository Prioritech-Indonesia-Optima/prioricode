import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@prioricode/core/v1/config/config"
import { Provider } from "@/provider/provider"
import { usable, triggerPoint, isOverflow } from "@/session/overflow"

function model(opts: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: { context: opts.context, input: opts.input, output: opts.output },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

function tokens(count: number) {
  return { input: count, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: count }
}

describe("usable()", () => {
  test("uses 128k default when context is 0 and no default_context set", () => {
    const result = usable({ cfg: {}, model: model({ context: 0, output: 4096 }) })
    expect(result).toBe(128_000 - 4_096)
  })

  test("uses default_context when context is 0", () => {
    const cfg: ConfigV1.Info = { compaction: { default_context: 128_000 } }
    const result = usable({ cfg, model: model({ context: 0, output: 4096 }) })
    expect(result).toBeGreaterThan(0)
    expect(result).toBe(128_000 - Math.min(4096, 32_000))
  })

  test("default_context=0 disables usable for undeclared models", () => {
    const cfg: ConfigV1.Info = { compaction: { default_context: 0 } }
    const result = usable({ cfg, model: model({ context: 0, output: 4096 }) })
    expect(result).toBe(0)
  })

  test("uses limit.input when available", () => {
    const result = usable({ cfg: {}, model: model({ context: 200_000, input: 180_000, output: 32_000 }) })
    expect(result).toBe(180_000 - 20_000)
  })

  test("uses context minus maxOutputTokens when no limit.input", () => {
    const result = usable({ cfg: {}, model: model({ context: 200_000, output: 8_000 }) })
    expect(result).toBe(200_000 - 8_000)
  })

  test("respects explicit reserved", () => {
    const cfg: ConfigV1.Info = { compaction: { reserved: 5_000 } }
    const result = usable({ cfg, model: model({ context: 200_000, input: 180_000, output: 32_000 }) })
    expect(result).toBe(180_000 - 5_000)
  })
})

describe("triggerPoint()", () => {
  test("falls back to usable() when threshold is not set", () => {
    const m = model({ context: 200_000, output: 8_000 })
    expect(triggerPoint({ cfg: {}, model: m })).toBe(usable({ cfg: {}, model: m }))
  })

  test("returns percentage of context window when threshold is set", () => {
    const cfg: ConfigV1.Info = { compaction: { threshold: 85 } }
    const m = model({ context: 200_000, output: 8_000 })
    expect(triggerPoint({ cfg, model: m })).toBe(170_000)
  })

  test("threshold 90 on 128k window", () => {
    const cfg: ConfigV1.Info = { compaction: { threshold: 90 } }
    const m = model({ context: 128_000, output: 4_096 })
    expect(triggerPoint({ cfg, model: m })).toBe(115_200)
  })

  test("threshold 100 equals context window", () => {
    const cfg: ConfigV1.Info = { compaction: { threshold: 100 } }
    const m = model({ context: 128_000, output: 4_096 })
    expect(triggerPoint({ cfg, model: m })).toBe(128_000)
  })

  test("threshold > 100 is clamped to 100", () => {
    const cfg: ConfigV1.Info = { compaction: { threshold: 150 } }
    const m = model({ context: 128_000, output: 4_096 })
    expect(triggerPoint({ cfg, model: m })).toBe(128_000)
  })

  test("returns 0 when context is 0 and default_context is 0", () => {
    const cfg: ConfigV1.Info = { compaction: { threshold: 85, default_context: 0 } }
    const m = model({ context: 0, output: 4_096 })
    expect(triggerPoint({ cfg, model: m })).toBe(0)
  })

  test("uses default_context when context is 0 and threshold is set", () => {
    const cfg: ConfigV1.Info = { compaction: { threshold: 85, default_context: 128_000 } }
    const m = model({ context: 0, output: 4_096 })
    expect(triggerPoint({ cfg, model: m })).toBe(108_800)
  })
})

describe("isOverflow()", () => {
  test("returns false when auto is false", () => {
    const cfg: ConfigV1.Info = { compaction: { auto: false } }
    const m = model({ context: 1000, output: 100 })
    expect(isOverflow({ cfg, tokens: tokens(9999), model: m })).toBe(false)
  })

  test("returns false when context is 0 and default_context is 0", () => {
    const cfg: ConfigV1.Info = { compaction: { default_context: 0 } }
    const m = model({ context: 0, output: 4096 })
    expect(isOverflow({ cfg, tokens: tokens(999_999), model: m })).toBe(false)
  })

  test("detects overflow at usable boundary (no threshold)", () => {
    const m = model({ context: 10_000, output: 2_000 })
    const u = usable({ cfg: {}, model: m })
    expect(isOverflow({ cfg: {}, tokens: tokens(u - 1), model: m })).toBe(false)
    expect(isOverflow({ cfg: {}, tokens: tokens(u), model: m })).toBe(true)
  })

  test("detects overflow at threshold percentage", () => {
    const cfg: ConfigV1.Info = { compaction: { threshold: 80 } }
    const m = model({ context: 100_000, output: 8_000 })
    expect(isOverflow({ cfg, tokens: tokens(79_999), model: m })).toBe(false)
    expect(isOverflow({ cfg, tokens: tokens(80_000), model: m })).toBe(true)
  })

  test("threshold triggers earlier than reserved-based usable", () => {
    const m = model({ context: 100_000, output: 8_000 })
    const withoutThreshold = usable({ cfg: {}, model: m })
    const cfg: ConfigV1.Info = { compaction: { threshold: 70 } }
    const withThreshold = triggerPoint({ cfg, model: m })
    expect(withThreshold).toBeLessThan(withoutThreshold)
    expect(isOverflow({ cfg, tokens: tokens(withThreshold), model: m })).toBe(true)
    expect(isOverflow({ cfg: {}, tokens: tokens(withThreshold), model: m })).toBe(false)
  })

  test("works with default_context for undeclared models", () => {
    const cfg: ConfigV1.Info = { compaction: { threshold: 85, default_context: 128_000 } }
    const m = model({ context: 0, output: 4_096 })
    expect(isOverflow({ cfg, tokens: tokens(108_799), model: m })).toBe(false)
    expect(isOverflow({ cfg, tokens: tokens(108_800), model: m })).toBe(true)
  })

  test("uses total field when available", () => {
    const cfg: ConfigV1.Info = { compaction: { threshold: 50 } }
    const m = model({ context: 100_000, output: 8_000 })
    const t = { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 }, total: 50_000 }
    expect(isOverflow({ cfg, tokens: t, model: m })).toBe(true)
  })

  test("falls back to sum when total is 0", () => {
    const cfg: ConfigV1.Info = { compaction: { threshold: 50 } }
    const m = model({ context: 100_000, output: 8_000 })
    const t = { input: 25_000, output: 10_000, reasoning: 0, cache: { read: 10_000, write: 5_000 } }
    expect(isOverflow({ cfg, tokens: t, model: m })).toBe(true)
  })
})
