import { describe, expect, test } from "bun:test"
import type { SnapshotFileDiff } from "@prioricode/sdk/v2"
import type { FileDiffInfo } from "@prioricode/client/promise"
import type { Message } from "@prioricode/sdk/v2/client"
import { diffs, message } from "./diffs"

const item = {
  file: "src/app.ts",
  patch: "@@ -1 +1 @@\n-old\n+new\n",
  additions: 1,
  deletions: 1,
  status: "modified",
} satisfies FileDiffInfo & SnapshotFileDiff

describe("diffs", () => {
  test("keeps valid arrays", () => {
    expect(diffs([item])).toEqual([item])
  })

  test("wraps a single diff object", () => {
    expect(diffs(item)).toEqual([item])
  })

  test("reads keyed diff objects", () => {
    expect(diffs({ a: item })).toEqual([item])
  })

  test("drops invalid entries", () => {
    expect(
      diffs([
        item,
        { file: "src/bad.ts", additions: 1, deletions: 1 },
        { patch: item.patch, additions: 1, deletions: 1 },
      ]),
    ).toEqual([item])
  })
})

describe("message", () => {
  test("normalizes user summaries with object diffs", () => {
    const input = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      summary: {
        title: "Edit",
        diffs: { a: item },
      },
    } as unknown as Message

    expect(message(input)).toMatchObject({
      summary: {
        title: "Edit",
        diffs: [item],
      },
    })
  })

  test("drops invalid user summaries", () => {
    const input = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      summary: true,
    } as unknown as Message

    expect(message(input)).toMatchObject({ summary: undefined })
  })

  test("keeps small patches untouched", () => {
    const input = userMessage([item])
    expect(message(input)).toMatchObject({ summary: { diffs: [item] } })
  })

  test("drops a single patch above the per-file budget", () => {
    const big = { ...item, patch: "x".repeat(1_000_001) }
    const result = message(userMessage([big, item])) as unknown as {
      summary: { diffs: (FileDiffInfo & { patch: string })[] }
    }
    expect(result.summary.diffs[0]).toMatchObject({ patch: "", additions: 1, deletions: 1 })
    expect(result.summary.diffs[1]?.patch).toBe(item.patch)
  })

  test("drops patches beyond the total budget", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...item,
      file: `src/f${i}.ts`,
      patch: "y".repeat(900_000),
    }))
    const result = message(userMessage(many)) as unknown as {
      summary: { diffs: (FileDiffInfo & { patch: string })[] }
    }
    expect(result.summary.diffs.slice(0, 4).every((d) => d.patch.length === 900_000)).toBe(true)
    expect(result.summary.diffs.slice(4).every((d) => d.patch === "")).toBe(true)
  })
})

function userMessage(items: unknown[]) {
  return {
    id: "msg_1",
    sessionID: "ses_1",
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
    summary: { diffs: items },
  } as unknown as Message
}
