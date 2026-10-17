import { describe, expect, test } from "bun:test"
import { createFatalErrorForwarder } from "./fatal-error-forwarder"

type Payload = { error: string; url: string; version?: string; platform: string; os?: string }

function setup(options?: { max?: number; reject?: boolean }) {
  const recorded: Payload[] = []
  const forward = createFatalErrorForwarder({
    record: async (payload) => {
      if (options?.reject) throw new Error("ipc dead")
      recorded.push(payload)
    },
    info: { version: "9.9.9", platform: "desktop", os: "linux", url: () => "pc://renderer/index.html" },
    max: options?.max ?? 20,
  })
  return { recorded, forward }
}

describe("renderer fatal error forwarder", () => {
  test("forwards distinct async failures with app metadata", () => {
    const h = setup()
    h.forward("window-error", "Uncaught TypeError: x is not a function\nstack1")
    h.forward("unhandled-rejection", "stream exploded")
    expect(h.recorded).toHaveLength(2)
    expect(h.recorded[0]).toMatchObject({
      error: "window-error: Uncaught TypeError: x is not a function\nstack1",
      url: "pc://renderer/index.html",
      version: "9.9.9",
      platform: "desktop",
      os: "linux",
    })
  })

  test("dedupes repeats and empty details", () => {
    const h = setup()
    h.forward("window-error", "same failure")
    h.forward("window-error", "same failure")
    h.forward("window-error", "")
    expect(h.recorded).toHaveLength(1)
  })

  test("caps total forwards (flood protection)", () => {
    const h = setup({ max: 3 })
    for (let index = 0; index < 10; index++) h.forward("unhandled-rejection", `failure ${index}`)
    expect(h.recorded).toHaveLength(3)
  })

  test("a failing record path never throws out of the forwarder", () => {
    const h = setup({ reject: true })
    expect(() => h.forward("window-error", "boom")).not.toThrow()
  })
})
