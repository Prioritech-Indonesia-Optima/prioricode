import { describe, expect, test } from "bun:test"
import { createWslServersController, type WslServerConfig } from "./servers"

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
    url: "http://127.0.0.1:4096",
    username: "prioricode",
    password: "secret",
    triggerExit: (code = 1) => exitCb?.(code, null),
  }
  return sidecar
}

function setup() {
  let persisted: WslServerConfig[] = []
  const state = { unreachable: false, spawns: 0, errors: [] as unknown[] }
  let current: FakeSidecar | undefined
  const controller = createWslServersController(
    "1.16.2",
    async () => {
      state.spawns += 1
      if (state.unreachable) throw new Error("wsl sidecar failed to start")
      current = fakeSidecar()
      return current as never
    },
    {
      readServers: () => persisted,
      writeServers: (servers) => {
        persisted = servers
      },
      resolvePrioricode: async () => "/home/me/.prioricode/bin/prioricode",
      readCommandVersion: async () => "1.16.2",
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

describe("wsl server wake recovery", () => {
  test("power wake revives a WSL server whose reconnect ladder exhausted", async () => {
    const h = setup()
    await h.controller.addServer("Debian")
    expect(await waitFor(() => h.runtimeKind() === "ready")).toBe(true)

    // Distro shuts down (e.g. laptop sleep reclaimed WSL).
    h.state.unreachable = true
    h.current()!.triggerExit(137)
    expect(await waitFor(() => h.runtimeKind() === "failed")).toBe(true)
    const spawnsBeforeWake = h.state.spawns

    // Wake while still down: one bounded retry, stays failed, never loops hot.
    h.controller.retryDisconnected()
    await sleep(80)
    expect(h.runtimeKind()).toBe("failed")

    // Distro back: wake path revives the server.
    h.state.unreachable = false
    h.controller.retryDisconnected()
    expect(await waitFor(() => h.runtimeKind() === "ready")).toBe(true)
    expect(h.state.spawns).toBeGreaterThan(spawnsBeforeWake)
  })
})
