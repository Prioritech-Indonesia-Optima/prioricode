import { describe, expect, test } from "bun:test"
import { clipboardPayload } from "../../src/cli/cmd/paste-serve"

describe("paste-serve payload", () => {
  test("text maps to text", () => {
    expect(clipboardPayload({ data: "hello", mime: "text/plain" })).toEqual({ text: "hello" })
  })

  test("images map to base64 image", () => {
    expect(clipboardPayload({ data: "aW1n", mime: "image/png" })).toEqual({
      image: { base64: "aW1n", mime: "image/png" },
    })
  })

  test("unknown content maps to nothing", () => {
    expect(clipboardPayload(undefined)).toBeUndefined()
    expect(clipboardPayload({ data: "x", mime: "video/mp4" })).toBeUndefined()
  })
})
