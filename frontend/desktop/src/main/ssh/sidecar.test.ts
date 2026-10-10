import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import { createServer, type Server } from "node:net"

mock.module("../server", () => ({
  checkHealth: async () => true,
}))

let portOverride: number | null = null
mock.module("../ports", () => ({
  allocateLoopbackPort: async () => {
    if (portOverride !== null) return portOverride
    return await new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        const port = typeof address === "object" && address ? address.port : 0
        server.close(() => resolve(port))
      })
    })
  },
}))

function listenOn(port: number) {
  return new Promise<Server>((resolve) => {
    const server = createServer()
    server.listen(port, "127.0.0.1", () => resolve(server))
  })
}

async function reserveFreePort() {
  const server = await listenOn(0)
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

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
  const args: unknown[][] = []
  const spawn = ((...spawnArgs: unknown[]) => {
    args.push(spawnArgs)
    const child = new FakeChild()
    children.push(child)
    handlers[children.length - 1]?.(child)
    return child
  }) as never
  return { children, args, spawn }
}

const pwAssignment = new RegExp("PW='" + "[0-9a-f-]{36}" + "'")

const marker = (over: Partial<{ port: number; version: string; password: string; reused: boolean }> = {}) =>
  `${SSH_BOOTSTRAP_MARKER} ${JSON.stringify({ port: 4096, version: "0.1.18", password: "pw-1", reused: false, ...over })}\n`

describe("spawnSshSidecar", () => {
  test("happy path: script via stdin, tunnel child, health gate, ready sidecar", async () => {
    const { children, spawn } = harness({ 0: (child) => child.succeed(""), 1: (child) => child.succeed(marker()) })
    const sidecar = await spawnSshSidecar("web", { spawn, healthTimeoutMs: 2_000, bootstrapTimeoutMs: 5_000 })
    expect(children).toHaveLength(3)
    const [, exec, tunnel] = children
    expect(pwAssignment.test(exec.stdinData)).toBeTrue()
    expect(sidecar.username).toBe("prioricode")
    expect(sidecar.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(sidecar.password).toBe("pw-1")
    expect(sidecar.reused).toBeFalse()
    sidecar.listener.stop()
    expect(tunnel!.killed).toBeTrue()
  })

  test("missing binary maps to the install hint error", async () => {
    const { children, spawn } = harness({
      0: (child) => child.succeed(""),
      1: (child) => child.succeed("PRIORICODE_SSH_BOOTSTRAP_ERROR missing_binary\n"),
    })
    await expect(spawnSshSidecar("web", { spawn })).rejects.toThrow(/PrioriCode is not installed on web/)
    expect(children).toHaveLength(2)
  })

  test("tunnel exit before healthy rejects", async () => {
    const { children, spawn } = harness({
      0: (child) => child.succeed(""),
      1: (child) => child.succeed(marker()),
      2: (child) => child.die(255, "Connection refused\n"),
    })
    await expect(spawnSshSidecar("web", { spawn, healthTimeoutMs: 2_000 })).rejects.toThrow(/SSH tunnel to web/)
    expect(children).toHaveLength(3)
  })

  test("config remote-forward failure retries the tunnel without ExitOnForwardFailure", async () => {
    const dummy = await listenOn(0)
    const address = dummy.address()
    portOverride = typeof address === "object" && address ? address.port : 0
    const { children, args, spawn } = harness({
      0: (child) => child.succeed(""),
      1: (child) => child.succeed(marker()),
      2: (child) => child.die(255, "Error: remote port forwarding failed for listen port 48917\n"),
    })
    const sidecar = await spawnSshSidecar("web", { spawn, healthTimeoutMs: 2_000, bootstrapTimeoutMs: 5_000 })
    expect(children).toHaveLength(4)
    expect((args[2]![1] as string[]).join(" ")).toContain("ExitOnForwardFailure=yes")
    expect((args[3]![1] as string[]).join(" ")).not.toContain("ExitOnForwardFailure")
    sidecar.listener.stop()
    dummy.close()
    portOverride = null
  })

  test("retry path fails fast when the local tunnel port never listens", async () => {
    portOverride = await reserveFreePort()
    const { spawn } = harness({
      0: (child) => child.succeed(""),
      1: (child) => child.succeed(marker()),
      2: (child) => child.die(255, "Error: remote port forwarding failed for listen port 48917\n"),
    })
    await expect(spawnSshSidecar("web", { spawn, healthTimeoutMs: 2_000, listenerTimeoutMs: 400 })).rejects.toThrow(
      /already in use/,
    )
    portOverride = null
  })

  test("local listen failure maps to the port-busy error", async () => {
    const { children, spawn } = harness({
      0: (child) => child.succeed(""),
      1: (child) => child.succeed(marker()),
      2: (child) => child.die(255, "bind [127.0.0.1]:41234: Address already in use\n"),
    })
    await expect(spawnSshSidecar("web", { spawn, healthTimeoutMs: 2_000 })).rejects.toThrow(/already in use/)
    expect(children).toHaveLength(3)
  })

  test("stale reused server recovers via stop + fresh bootstrap + new tunnel", async () => {
    const { children, spawn } = harness({
      0: (child) => child.succeed(""),
      1: (child) => child.succeed(marker({ reused: true, password: "old-pw" })),
      2: (child) => child.die(255, "bind: Cannot assign requested address\n"),
      3: (child) => child.succeed(""),
      4: (child) => child.succeed(marker({ password: "fresh-pw", reused: false })),
    })
    const sidecar = await spawnSshSidecar("web", { spawn, healthTimeoutMs: 2_000, bootstrapTimeoutMs: 5_000 })
    expect(sidecar.reused).toBeFalse()
    expect(sidecar.password).toBe("fresh-pw")
    // children: probe, bootstrap exec, dead tunnel, remote stop exec, fresh bootstrap exec, live tunnel
    expect(children).toHaveLength(6)
    const scripts = children.filter((child) => child.stdinData.startsWith("set -eu")).map((child) => child.stdinData)
    expect(scripts).toHaveLength(3)
    expect(scripts[1]).toContain('kill "$(cat "$D/pid")"')
    expect(pwAssignment.test(scripts[2]!)).toBeTrue()
    sidecar.listener.stop()
  })
})

test("probe auth failure is classified before bootstrap runs", async () => {
  const { children, spawn } = harness({
    0: (child) => {
      queueMicrotask(() => {
        child.stderr.emitData("git@github: Permission denied (publickey).\n")
        child.emit("exit", 255, null)
      })
    },
  })
  await expect(spawnSshSidecar("web", { spawn })).rejects.toThrow(/authentication failed for web/)
  expect(children).toHaveLength(1)
})

test("probe network failure is classified as unreachable", async () => {
  const { spawn } = harness({
    0: (child) => {
      queueMicrotask(() => {
        child.stderr.emitData("ssh: connect to host web port 22: Connection timed out\r\n")
        child.emit("exit", 255, null)
      })
    },
  })
  await expect(spawnSshSidecar("web", { spawn })).rejects.toThrow(/Could not reach web/)
})

test("missing ssh binary produces an install hint", async () => {
  const spawn = ((..._args: unknown[]) => {
    const child = new FakeChild()
    queueMicrotask(() => {
      const error = new Error("spawn ssh ENOENT") as Error & { code?: string }
      error.code = "ENOENT"
      child.emit("error", error)
    })
    return child
  }) as never
  await expect(spawnSshSidecar("web", { spawn })).rejects.toThrow(/ssh command was not found/)
})
