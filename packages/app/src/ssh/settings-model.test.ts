import { expect, test } from "bun:test"
import { sshHostMeta, sshPrioricodeAction, sshRuntimeRetryable, sshServerIdFor } from "./settings-model"

const check = (over: Partial<import("./types").SshPrioricodeCheck>) => ({
  alias: "web",
  resolvedPath: null,
  version: null,
  expectedVersion: "0.1.18",
  matchesDesktop: null,
  error: null,
  ...over,
})

test("retryable runtimes are failed and stopped", () => {
  expect(sshRuntimeRetryable({ kind: "failed", message: "x" })).toBeTrue()
  expect(sshRuntimeRetryable({ kind: "stopped" })).toBeTrue()
  expect(sshRuntimeRetryable({ kind: "starting" })).toBeFalse()
  expect(
    sshRuntimeRetryable({ kind: "ready", url: "http://127.0.0.1:1", username: null, password: null }),
  ).toBeFalse()
})

test("prioricode action suggests install or update only", () => {
  expect(sshPrioricodeAction(undefined)).toBeUndefined()
  expect(sshPrioricodeAction(check({}))).toBe("ssh.server.install")
  expect(sshPrioricodeAction(check({ resolvedPath: "/x/prioricode", version: "0.1.18", matchesDesktop: true }))).toBeUndefined()
  expect(sshPrioricodeAction(check({ resolvedPath: "/x/prioricode", version: "1.0.0", matchesDesktop: false }))).toBe(
    "ssh.server.update",
  )
})

test("host meta prefers user@hostname:port and skips redundant aliases", () => {
  expect(sshHostMeta({ alias: "web", hostname: "web.example.com", user: "deploy", port: 2222 })).toBe(
    "deploy@web.example.com:2222",
  )
  expect(sshHostMeta({ alias: "web", hostname: "web", user: null, port: null })).toBe("web")
  expect(sshHostMeta({ alias: "web", hostname: null, user: "root", port: null })).toBe("root@web")
})

test("server id mirrors ServerConnection ssh key", () => {
  expect(sshServerIdFor("web-prod")).toBe("ssh:web-prod")
})
