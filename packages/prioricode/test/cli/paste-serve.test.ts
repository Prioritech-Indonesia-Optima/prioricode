import { describe, expect, test } from "bun:test"
import {
  autostartTarget,
  clipboardPayload,
  ensureRemoteForward,
  SSH_BRIDGE_MARKER,
} from "../../src/cli/cmd/paste-serve"

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

describe("paste-serve ssh config wiring", () => {
  test("appends a managed forward block when absent", () => {
    const result = ensureRemoteForward("Host example\n  User dev\n", 48917)
    expect(result.changed).toBe(true)
    expect(result.text).toContain(`${SSH_BRIDGE_MARKER}\nHost *\n  RemoteForward 48917 localhost:48917`)
    expect(result.text).toContain("Host example")
  })

  test("is idempotent", () => {
    const once = ensureRemoteForward("", 48917).text
    const twice = ensureRemoteForward(once, 48917)
    expect(twice.changed).toBe(false)
    expect(twice.text).toBe(once)
  })

  test("rewrites the managed block when the port changes", () => {
    const seeded = ensureRemoteForward("", 48917).text
    const result = ensureRemoteForward(seeded, 50000)
    expect(result.changed).toBe(true)
    expect(result.text).toContain("RemoteForward 50000 localhost:50000")
    expect(result.text).not.toContain("48917")
  })

  test("respects a user-managed forward for the same port", () => {
    const custom = "Host example\n  RemoteForward 48917 localhost:48917\n"
    const result = ensureRemoteForward(custom, 48917)
    expect(result.changed).toBe(false)
    expect(result.text).toBe(custom)
  })
})

describe("paste-serve login autostart", () => {
  const args = ["/usr/local/bin/prioricode", "paste-serve"]

  test("windows registers a Run key value", () => {
    const target = autostartTarget("win32", "C:\\Users\\dev", args)
    expect(target.kind).toBe("registry")
    expect(target.regArgs?.join(" ")).toContain('"/usr/local/bin/prioricode" "paste-serve"')
  })

  test("macos writes a LaunchAgent plist with argument array", () => {
    const target = autostartTarget("darwin", "/home/dev", args)
    expect(target.path).toContain("LaunchAgents/com.prioricode.paste-serve.plist")
    expect(target.content).toContain("<string>/usr/local/bin/prioricode</string><string>paste-serve</string>")
    expect(target.content).toContain("RunAtLoad")
  })

  test("linux writes an XDG autostart entry with quoted paths", () => {
    const target = autostartTarget("linux", "/home/dev", ["/home/my user/bin/prioricode", "paste-serve"])
    expect(target.path).toContain(".config/autostart/prioricode-paste-serve.desktop")
    expect(target.content).toContain('Exec="/home/my user/bin/prioricode" paste-serve')
  })
})
