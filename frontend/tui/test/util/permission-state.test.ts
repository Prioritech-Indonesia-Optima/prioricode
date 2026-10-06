import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@prioricode/sdk/v2"
import { appendDecision, groupPermissionsBySession } from "../../src/util/permission-state"

const request = (id: string, sessionID: string): PermissionRequest =>
  ({ id, sessionID, permission: "edit", patterns: [], metadata: {}, always: [] }) as unknown as PermissionRequest

describe("groupPermissionsBySession", () => {
  test("groups by session and sorts each queue by id (binary-search invariant)", () => {
    const grouped = groupPermissionsBySession([
      request("per_c", "ses_1"),
      request("per_a", "ses_1"),
      request("per_b", "ses_2"),
    ])
    expect(Object.keys(grouped).sort()).toEqual(["ses_1", "ses_2"])
    expect(grouped.ses_1?.map((r) => r.id)).toEqual(["per_a", "per_c"])
    expect(grouped.ses_2?.map((r) => r.id)).toEqual(["per_b"])
  })

  test("empty input yields empty map", () => {
    expect(groupPermissionsBySession([])).toEqual({})
  })
})

describe("appendDecision", () => {
  test("creates history from undefined", () => {
    expect(appendDecision(undefined, 1, 3)).toEqual([1])
  })

  test("appends and keeps bounded, dropping oldest", () => {
    let history: number[] | undefined
    for (const value of [1, 2, 3, 4, 5]) history = appendDecision(history, value, 3)
    expect(history).toEqual([3, 4, 5])
  })

  test("does not mutate previous history", () => {
    const before = [1, 2]
    const after = appendDecision(before, 3, 10)
    expect(before).toEqual([1, 2])
    expect(after).toEqual([1, 2, 3])
  })
})
