import { describe, expect, mock, test } from "bun:test"
import type { SshServerConfig } from "@prioricode/app/ssh/types"

// The ssh controller chain pulls ../server (named electron imports) through
// ssh/sidecar.ts. Register module mocks BEFORE importing ./servers (lazy
// import), exactly like ssh/sidecar.test.ts does, so this file loads outside
// the Electron runtime.
mock.module("../server", () => ({
  checkHealth: async () => true,
}))
mock.module("../ports", () => ({
  allocateLoopbackPort: async () => 41234,
}))

const { createSshServersController } = await import("./servers")

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check: () => boolean, timeoutMs = 1_500) {
  for (let elapsed = 0; elapsed < timeoutMs; elapsed += 10) {
    if (check()) return true
    await sleep(10)
  }
  return check()
}

type FakeSidecar = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string | null
  password: string
  triggerExit: (code?: number | null) => void
}

function fakeSidecar(): FakeSidecar {
  let exitCb: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
  const sidecar: FakeSidecar = {
    listener: {
      stop: () => undefined,
      onExit: (cb) => {
        exitCb = cb
      },
    },
    url: "http://127.0.0.1:41234",
    username: "prioricode",
    password: "secret",
    triggerExit: (code = 1) => exitCb?.(code, null),
  }
  return sidecar
}

function setup() {
  let persisted: SshServerConfig[] = []
  const state = { unreachable: false, spawns: 0, errors: [] as unknown[] }
  let current: FakeSidecar | undefined
  const controller = createSshServersController(
    "1.2.3",
    async () => {
      state.spawns += 1
      if (state.unreachable) throw new Error("ssh: connect to host port 22: Connection refused")
      current = fakeSidecar()
      return current as never
    },
    {
      readServers: () => persisted,
      writeServers: (servers) => {
        persisted = servers
      },
      readHosts: () => ({ profiles: [], files: [] }),
      remoteExec: async () => ({ code: 0, output: "" }),
      reconnectBaseDelayMs: 5,
      reconnectMaxAttempts: 2,
      logger: {
        log: () => undefined,
        error: (message: string, meta?: unknown) => state.errors.push({ message, meta }),
      },
    },
  )
  const runtimeKind = () => controller.getState().servers[0]?.runtime.kind
  return { controller, state, current: () => current, runtimeKind }
}

describe("ssh server wake recovery", () => {
  test("power wake revives a server whose reconnect ladder exhausted during sleep", async () => {
    const h = setup()
    await h.controller.addServer("workstation")
    expect(await waitFor(() => h.runtimeKind() === "ready")).toBe(true)

    // Laptop closes: network drops, remote side dies.
    h.state.unreachable = true
    h.current()!.triggerExit(137)
    expect(await waitFor(() => h.runtimeKind() === "failed")).toBe(true)
    const spawnsBeforeWake = h.state.spawns

    // Wake while still unreachable: a single retry, stays failed, no crash loop.
    h.controller.retryDisconnected()
    await sleep(60)
    expect(h.runtimeKind()).toBe("failed")

    // VPN back up: the same wake path revives the server.
    h.state.unreachable = false
    h.controller.retryDisconnected()
    expect(await waitFor(() => h.runtimeKind() === "ready")).toBe(true)
    expect(h.state.spawns).toBeGreaterThan(spawnsBeforeWake)
  })

  test("retryDisconnected during an active reconnect ladder re-arms immediately", async () => {
    const h = setup()
    await h.controller.addServer("builder")
    expect(await waitFor(() => h.runtimeKind() === "ready")).toBe(true)

    h.state.unreachable = true
    h.current()!.triggerExit(137)
    expect(h.runtimeKind()).toBe("reconnecting")
    const spawnsBeforeWake = h.state.spawns

    // Network restored at wake: retryDisconnected must start now, not wait out the ladder.
    h.state.unreachable = false
    h.controller.retryDisconnected()
    expect(await waitFor(() => h.runtimeKind() === "ready")).toBe(true)
    expect(h.state.spawns).toBeGreaterThan(spawnsBeforeWake)
  })

  test("servers the user stopped manually are never resurrected", async () => {
    const h = setup()
    await h.controller.addServer("laptop")
    expect(await waitFor(() => h.runtimeKind() === "ready")).toBe(true)

    await h.controller.stopServer("ssh:laptop")
    expect(h.runtimeKind()).toBe("stopped")
    const spawnsBeforeWake = h.state.spawns

    h.controller.retryDisconnected()
    await sleep(60)
    expect(h.runtimeKind()).toBe("stopped")
    expect(h.state.spawns).toBe(spawnsBeforeWake)
  })
})
