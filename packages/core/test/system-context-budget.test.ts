import { describe, expect, test } from "bun:test"
import { SystemContextBudget } from "@prioricode/core/system-context/budget"

describe("context budget tier", () => {
  test("quantizes on 25% band boundaries", () => {
    expect(SystemContextBudget.tierFor(0)).toBe("low")
    expect(SystemContextBudget.tierFor(-10)).toBe("low")
    expect(SystemContextBudget.tierFor(Number.NaN)).toBe("low")
    expect(SystemContextBudget.tierFor(24.9)).toBe("low")
    expect(SystemContextBudget.tierFor(25)).toBe("moderate")
    expect(SystemContextBudget.tierFor(49.9)).toBe("moderate")
    expect(SystemContextBudget.tierFor(50)).toBe("high")
    expect(SystemContextBudget.tierFor(74.9)).toBe("high")
    expect(SystemContextBudget.tierFor(75)).toBe("critical")
    expect(SystemContextBudget.tierFor(100)).toBe("critical")
    expect(SystemContextBudget.tierFor(240)).toBe("critical")
  })

  test("renders the tier with concrete guidance and stable keys", () => {
    expect(SystemContextBudget.render("high")).toContain("Context usage tier: high")
    expect(SystemContextBudget.render("critical")).toContain("economical")
    expect(SystemContextBudget.context(10)).toBe(SystemContextBudget.context(0))
    expect(SystemContextBudget.context(30)).not.toBe(SystemContextBudget.context(80))
  })
})
