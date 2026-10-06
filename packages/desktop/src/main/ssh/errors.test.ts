import { describe, expect, test } from "bun:test"
import { classifySshFailure, isValidSshAlias } from "./errors"

describe("isValidSshAlias", () => {
  test("accepts normal aliases and user@host tokens", () => {
    expect(isValidSshAlias("web-prod")).toBeTrue()
    expect(isValidSshAlias("deploy@10.0.0.5")).toBeTrue()
    expect(isValidSshAlias("box.example.com")).toBeTrue()
  })

  test("rejects option-injection and malformed tokens", () => {
    expect(isValidSshAlias("-oProxyCommand=evil")).toBeFalse()
    expect(isValidSshAlias("--upload=script.sh")).toBeFalse()
    expect(isValidSshAlias("")).toBeFalse()
    expect(isValidSshAlias("two words")).toBeFalse()
    expect(isValidSshAlias(" padded ")).toBeFalse()
    expect(isValidSshAlias("line\nbreak")).toBeFalse()
    expect(isValidSshAlias("bell\u0007")).toBeFalse()
    expect(isValidSshAlias("x".repeat(513))).toBeFalse()
  })
})

describe("classifySshFailure", () => {
  test("auth denial points at keys and agents", () => {
    const message = classifySshFailure("git@host: Permission denied (publickey).", "web", 255)
    expect(message).toMatch(/authentication failed for web/)
    expect(message).toMatch(/ssh-copy-id/)
  })

  test("too many authentication failures is also auth", () => {
    expect(classifySshFailure("Too many authentication failures", "web", 255)).toMatch(/authentication failed/)
  })

  test("dns failures say unresolved", () => {
    expect(classifySshFailure("ssh: Could not resolve hostname web: Name or service not known", "web", 255)).toMatch(
      /Could not resolve web/,
    )
  })

  test("host key mismatch tells the user to fix known_hosts", () => {
    expect(
      classifySshFailure("@@@@@@@@@@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED @@@@@@@@@", "web", 255),
    ).toMatch(/known_hosts/)
    expect(classifySshFailure("Host key verification failed.", "web", 255)).toMatch(/known_hosts/)
  })

  test("connectivity errors say unreachable", () => {
    expect(classifySshFailure("ssh: connect to host web port 22: No route to host", "web", 255)).toMatch(
      /Could not reach web/,
    )
    expect(classifySshFailure("Connection refused", "web", 255)).toMatch(/Could not reach web/)
  })

  test("unknown output falls back with the exit code", () => {
    expect(classifySshFailure("some exotic failure", "web", 255)).toMatch(/Could not connect to web/)
    expect(classifySshFailure("", "web", null)).toMatch(/exit code null/)
  })
})
