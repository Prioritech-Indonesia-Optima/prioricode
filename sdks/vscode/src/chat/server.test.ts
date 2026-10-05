import { describe, expect, it } from "bun:test"
import {
  discover,
  normalizeServerUrl,
  parseRegistration,
  parseServerTarget,
  stateDirectory,
  type DiscoveryDeps,
} from "./server"

const registration = JSON.stringify({ id: "abc", version: "1.2.3", url: "http://127.0.0.1:4096", pid: 42 })

const deps = (overrides: Partial<DiscoveryDeps>): DiscoveryDeps => ({
  env: { XDG_STATE_HOME: "/state" },
  homedir: () => "/home/u",
  readFile: async (file) => {
    if (file === "/state/prioricode/server.json") return registration
    if (file === "/state/prioricode/password") return "secret\n"
    throw new Error("missing " + file)
  },
  probe: async () => "ok",
  ...overrides,
})

describe("parseServerTarget", () => {
  it("extracts credentials from URL userinfo", () => {
    const target = parseServerTarget("http://dev:pass%201@10.0.0.5:4096")
    expect(target).toEqual({ url: "http://10.0.0.5:4096", username: "dev", password: "pass 1" })
  })

  it("uses defaults and fallback password", () => {
    expect(parseServerTarget("http://10.0.0.5:4096", "fallback")).toEqual({
      url: "http://10.0.0.5:4096",
      username: "prioricode",
      password: "fallback",
    })
    expect(parseServerTarget("http://10.0.0.5:4096")).toEqual({ url: "http://10.0.0.5:4096", username: "prioricode" })
  })

  it("rejects non-http schemes and garbage", () => {
    expect(parseServerTarget("ftp://host/x")).toBeUndefined()
    expect(parseServerTarget("not a url")).toBeUndefined()
  })
})

describe("discover with remote target", () => {
  const remote = { url: "http://10.0.0.5:4096", username: "prioricode", password: "pw" }

  it("probes the remote directly and never starts a local daemon", async () => {
    let started = false
    const result = await discover(
      deps({
        remote,
        probe: async () => "ok",
        startDaemon: async () => {
          started = true
          return true
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.server.url).toBe("http://10.0.0.5:4096")
    expect(started).toBe(false)
  })

  it("maps remote 401 to auth-mismatch and unreachable to offline", async () => {
    const unauthorized = await discover(deps({ remote, probe: async () => "unauthorized" }))
    expect(!unauthorized.ok && unauthorized.reason).toBe("auth-mismatch")
    const offline = await discover(deps({ remote, probe: async () => "unreachable" }))
    expect(!offline.ok && offline.reason).toBe("offline")
  })
})

describe("stateDirectory", () => {
  it("honors XDG_STATE_HOME and falls back to ~/.local/state", () => {
    expect(stateDirectory({ env: { XDG_STATE_HOME: "/xdg" }, homedir: () => "/h" })).toBe("/xdg/prioricode")
    expect(stateDirectory({ env: {}, homedir: () => "/h" })).toBe("/h/.local/state/prioricode")
  })
})

describe("normalizeServerUrl", () => {
  it("rewrites wildcard binds to loopback", () => {
    expect(normalizeServerUrl("http://0.0.0.0:4096")).toBe("http://127.0.0.1:4096")
    expect(normalizeServerUrl("http://[::]:4096")).toBe("http://127.0.0.1:4096")
    expect(normalizeServerUrl("http://localhost:4096/")).toBe("http://localhost:4096")
  })
})

describe("parseRegistration", () => {
  it("rejects malformed files", () => {
    expect(parseRegistration("not json")).toBeUndefined()
    expect(parseRegistration('{"pid":1}')).toBeUndefined()
    expect(parseRegistration(registration)?.url).toBe("http://127.0.0.1:4096")
  })
})

describe("discover", () => {
  it("returns server info with password from the state directory", async () => {
    const result = await discover(deps({}))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.server).toEqual({
      url: "http://127.0.0.1:4096",
      username: "prioricode",
      password: "secret",
      version: "1.2.3",
    })
  })

  it("surfaces auth mismatch without retrying", async () => {
    const started: string[] = []
    const result = await discover(
      deps({
        probe: async () => "unauthorized",
        startDaemon: async () => {
          started.push("called")
          return true
        },
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("auth-mismatch")
    expect(started).toEqual([])
  })

  it("starts the daemon when the registered server is dead", async () => {
    let probes = 0
    const result = await discover(
      deps({
        probe: async () => {
          probes += 1
          return probes === 1 ? "unreachable" : "ok"
        },
        startDaemon: async () => true,
      }),
    )
    expect(probes).toBe(2)
    expect(result.ok).toBe(true)
  })

  it("reports offline when there is no registration and start fails", async () => {
    const result = await discover(
      deps({
        readFile: async () => {
          throw new Error("missing")
        },
        probe: async () => "unreachable",
        startDaemon: async () => false,
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("offline")
  })

  it("works without a password file (open server)", async () => {
    const result = await discover(
      deps({
        readFile: async (file) => {
          if (file === "/state/prioricode/server.json") return registration
          throw new Error("missing")
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.server.password).toBeUndefined()
  })
})
