import { describe, expect, test } from "bun:test"
import { installProcessGuards, describeError } from "./process-guards"

function harness(options?: { quitting?: boolean; relaunchThrows?: boolean }) {
  const logs: Array<{ message: string; meta: Record<string, unknown> }> = []
  const state = { relaunches: 0, exits: [] as number[] }
  const dispose = installProcessGuards({
    log: (message, meta) => logs.push({ message, meta }),
    relaunch: () => {
      state.relaunches += 1
      if (options?.relaunchThrows) throw new Error("relaunch exploded")
    },
    isQuitting: () => options?.quitting ?? false,
    exit: (code) => {
      state.exits.push(code)
    },
  })
  return { logs, state, dispose }
}

describe("process guards", () => {
  test("describeError normalizes error and non-error values", () => {
    expect(describeError(new Error("m"))).toMatchObject({ name: "Error", message: "m" })
    expect(describeError("boom")).toEqual({ message: "boom" })
  })

  test("unhandled rejections are logged and the app survives", () => {
    const h = harness()
    try {
      process.emit("unhandledRejection", new Error("background task exploded"))
      expect(h.logs).toHaveLength(1)
      expect(h.logs[0]!.message).toBe("unhandled rejection")
      expect((h.logs[0]!.meta.reason as { name: string }).name).toBe("Error")
      expect(h.state.relaunches).toBe(0)
    } finally {
      h.dispose()
    }
  })

  test("uncaught exception relaunches exactly once", () => {
    const h = harness()
    try {
      process.emit("uncaughtException", new Error("main logic exploded"))
      process.emit("uncaughtException", new Error("main logic exploded again"))
      expect(h.state.relaunches).toBe(1)
      expect(h.logs.filter((log) => log.message === "uncaught exception")).toHaveLength(2)
    } finally {
      h.dispose()
    }
  })

  test("crashes during a deliberate quit do not relaunch", () => {
    const h = harness({ quitting: true })
    try {
      process.emit("uncaughtException", new Error("boom on the way out"))
      expect(h.state.relaunches).toBe(0)
      expect(h.logs).toHaveLength(1)
    } finally {
      h.dispose()
    }
  })

  test("a relaunch that itself fails falls back to exit", () => {
    const h = harness({ relaunchThrows: true })
    try {
      process.emit("uncaughtException", new Error("boom"))
      expect(h.state.relaunches).toBe(1)
      expect(h.state.exits).toEqual([1])
      expect(h.logs.map((log) => log.message)).toContain("relaunch after crash failed")
    } finally {
      h.dispose()
    }
  })

  test("dispose removes the handlers", () => {
    const h = harness()
    h.dispose()
    const before = h.logs.length
    process.emit("unhandledRejection", new Error("after dispose"))
    expect(h.logs.length).toBe(before)
  })
})
