import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"

mock.module("../server", () => ({
  checkHealth: async () => true,
}))

const { spawnSshSidecar } = await import("./sidecar")
const { SSH_BOOTSTRAP_MARKER } = await import("./commands")

class SyncStream {
  private cbs: ((chunk: string) => void)[] = []
  setEncoding() {}
  on(event: string, cb: (chunk: string) => void) {
    if (event === "data") this.cbs.push(cb)
    return this
  }
  once(event: string, cb: (chunk: string) => void) {
    return this.on(event, cb)
  }
  removeListener() {
    return this
  }
  emitData(chunk: string) {
    for (const cb of this.cbs) cb(chunk)
  }
  end() {}
}

class FakeChild extends EventEmitter {
  stdinData = ""
  stdin = {
    end: (data?: string) => {
      if (typeof data === "string") this.stdinData += data
    },
    write: (data: string) => {
      this.stdinData += data
    },
  }
  stdout = new SyncStream()
  stderr = new SyncStream()
  killed = false
  kill() {
    if (this.killed) return
    this.killed = true
    this.emit("exit", null, "SIGTERM")
  }
  succeed(text: string) {
    queueMicrotask(() => {
      this.stdout.emitData(text)
      this.emit("exit", 0, null)
    })
  }
  die(code: number, err = "") {
    queueMicrotask(() => {
      if (err) this.stderr.emitData(err)
      this.emit("exit", code, null)
    })
  }
}

function harness(handlers: Record<number, (child: FakeChild) => void>) {
  const children: FakeChild[] = []
  const spawn = ((..._args: unknown[]) => {
    const child = new FakeChild()
    children.push(child)
    handlers[children.length - 1]?.(child)
    return child
  }) as never
  return { children, spawn }
}

const pwAssignment = new RegExp("PW='" + "[0-9a-f-]{36}" + "'")

const marker = (over: Partial<{ port: number; version: string; password: string; reused: boolean }> = {}) =>
  `${SSH_BOOTSTRAP_MARKER} ${JSON.stringify({ port: 4096, version: "0.1.18", password: "pw-1", reused: false, ...over })}\n`

describe("spawnSshSidecar", () => {
  test("happy path: script via stdin, tunnel child, health gate, ready sidecar", async () => {
    const { children, spawn } = harness({ 0: (child) => child.succeed(marker()) })
    const sidecar = await spawnSshSidecar("web", { spawn, healthTimeoutMs: 2_000, bootstrapTimeoutMs: 5_000 })
    expect(children).toHaveLength(2)
    const [exec, tunnel] = children
    expect(pwAssignment.test(exec.stdinData)).toBeTrue()
    expect(sidecar.username).toBe("prioricode")
    expect(sidecar.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(sidecar.password).toBe("pw-1")
    expect(sidecar.reused).toBeFalse()
    sidecar.listener.stop()
    expect(tunnel!.killed).toBeTrue()
  })

  test("missing binary maps to the install hint error", async () => {
    const { spawn } = harness({ 0: (child) => child.succeed("PRIORICODE_SSH_BOOTSTRAP_ERROR missing_binary\n") })
    await expect(spawnSshSidecar("web", { spawn })).rejects.toThrow(/PrioriCode is not installed on web/)
  })

  test("tunnel exit before healthy rejects", async () => {
    const { children, spawn } = harness({
      0: (child) => child.succeed(marker()),
      1: (child) => child.die(255, "Connection refused\n"),
    })
    await expect(spawnSshSidecar("web", { spawn, healthTimeoutMs: 2_000 })).rejects.toThrow(/SSH tunnel to web/)
    expect(children).toHaveLength(2)
  })

  test("stale reused server recovers via stop + fresh bootstrap + new tunnel", async () => {
    const { children, spawn } = harness({
      0: (child) => child.succeed(marker({ reused: true, password: "old-pw" })),
      1: (child) => child.die(255, "bind: Cannot assign requested address\n"),
      2: (child) => child.succeed(""),
      3: (child) => child.succeed(marker({ password: "fresh-pw", reused: false })),
    })
    const sidecar = await spawnSshSidecar("web", { spawn, healthTimeoutMs: 2_000, bootstrapTimeoutMs: 5_000 })
    expect(sidecar.reused).toBeFalse()
    expect(sidecar.password).toBe("fresh-pw")
    // children: bootstrap exec, dead tunnel, remote stop exec, fresh bootstrap exec, live tunnel
    expect(children).toHaveLength(5)
    const scripts = children.filter((child) => child.stdinData.startsWith("set -eu")).map((child) => child.stdinData)
    expect(scripts).toHaveLength(3)
    expect(scripts[1]).toContain('kill "$(cat "$D/pid")"')
    expect(pwAssignment.test(scripts[2]!)).toBeTrue()
    sidecar.listener.stop()
  })
})
