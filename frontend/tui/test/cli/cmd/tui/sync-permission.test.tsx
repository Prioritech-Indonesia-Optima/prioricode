/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@prioricode/sdk/v2"
import { directory, mount, wait } from "./sync-fixture"

const request = (id: string): PermissionRequest =>
  ({
    id,
    sessionID: "ses_1",
    permission: "edit",
    patterns: ["src/**"],
    metadata: {},
    always: [],
  }) as unknown as PermissionRequest

const global = (payload: Record<string, unknown>) => ({
  directory,
  project: "proj_test",
  payload,
})

describe("permission queue sync", () => {
  test("replies are recorded in bounded per-session history before the queue entry disappears", async () => {
    const { app, emit, sync } = await mount()
    try {
      emit(global({ id: "evt_1", type: "permission.asked", properties: request("per_a") }) as never)
      emit(global({ id: "evt_2", type: "permission.asked", properties: request("per_b") }) as never)
      await wait(() => (sync.data.permission["ses_1"]?.length ?? 0) === 2)
      expect(sync.data.permission["ses_1"]?.map((r) => r.id)).toEqual(["per_a", "per_b"])

      emit(
        global({
          id: "evt_3",
          type: "permission.replied",
          properties: { sessionID: "ses_1", requestID: "per_a", reply: "once" },
        }) as never,
      )
      await wait(() => (sync.data.permission_history["ses_1"]?.length ?? 0) === 1)
      expect(sync.data.permission["ses_1"]?.map((r) => r.id)).toEqual(["per_b"])
      expect(sync.data.permission_history["ses_1"]).toEqual([
        { id: "per_a", permission: "edit", patterns: ["src/**"], reply: "once", time: expect.any(Number) },
      ])
    } finally {
      app.renderer.destroy()
    }
  })
})
