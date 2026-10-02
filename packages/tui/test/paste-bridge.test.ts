import { describe, expect, test } from "bun:test"
import { bridgePort, parseBridgePayload, PASTE_BRIDGE_DEFAULT_PORT } from "../src/paste-bridge"

describe("paste-bridge", () => {
  test("prefers images over text", () => {
    expect(parseBridgePayload({ text: "hello", image: { base64: "aW1hZ2U=", mime: "image/png" } })).toEqual({
      data: "aW1hZ2U=",
      mime: "image/png",
    })
  })

  test("maps text payloads", () => {
    expect(parseBridgePayload({ text: "hello" })).toEqual({ data: "hello", mime: "text/plain" })
  })

  test("rejects empty or malformed payloads", () => {
    expect(parseBridgePayload({})).toBeUndefined()
    expect(parseBridgePayload({ text: "" })).toBeUndefined()
    expect(parseBridgePayload(null)).toBeUndefined()
    expect(parseBridgePayload("nope")).toBeUndefined()
    expect(parseBridgePayload({ image: { base64: "", mime: "image/png" } })).toBeUndefined()
  })

  test("port comes from env with sane fallback", () => {
    expect(bridgePort({})).toBe(PASTE_BRIDGE_DEFAULT_PORT)
    expect(bridgePort({ PRIORICODE_PASTE_PORT: "50000" })).toBe(50000)
    expect(bridgePort({ PRIORICODE_PASTE_PORT: "not-a-port" })).toBe(PASTE_BRIDGE_DEFAULT_PORT)
    expect(bridgePort({ PRIORICODE_PASTE_PORT: "99999" })).toBe(PASTE_BRIDGE_DEFAULT_PORT)
  })
})
