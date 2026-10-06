import { describe, expect, it } from "bun:test"
import { computePatch, extractFencedDiff, patchStats, splitPatch } from "./diff"

describe("diff helpers", () => {
  it("computes a unified patch with stats", () => {
    const patch = computePatch("a.ts", "one\ntwo\n", "one\n2\nthree\n")
    expect(patch).toContain("--- a.ts")
    expect(patch).toContain("+++ a.ts")
    expect(patch).toContain("-two")
    expect(patch).toContain("+2")
    expect(patch).toContain("+three")
    const stats = patchStats(patch)
    expect(stats.deletions).toBe(1)
    expect(stats.additions).toBe(2)
  })

  it("classifies lines", () => {
    const lines = splitPatch("@@ -1 +1 @@\n-old\n+new\n context")
    expect(lines.map((line) => line.kind)).toEqual(["meta", "remove", "add", "context"])
  })

  it("extracts fenced diffs from tool summaries", () => {
    const text = "Edited file successfully: a.ts\n\n```diff\n-old\n+new\n```\nnotes"
    expect(extractFencedDiff(text)).toBe("-old\n+new\n")
    expect(extractFencedDiff("no fence here")).toBeUndefined()
    expect(extractFencedDiff(undefined)).toBeUndefined()
  })

  it("tolerates unterminated fences during streaming", () => {
    expect(extractFencedDiff("```diff\n-x\n+y")).toContain("+y")
  })
})
