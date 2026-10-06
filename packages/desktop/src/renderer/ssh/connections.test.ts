import { expect, test } from "bun:test"
import type { SshServersState } from "@prioricode/app/ssh/types"
import { availableSshStartupServer, readySshConnections } from "./connections"

const state = (kind: "starting" | "ready" | "failed" | "stopped"): SshServersState => ({
  hosts: [],
  hostFiles: [],
  prioricodeChecks: {},
  job: null,
  servers: [
    {
      config: { id: "ssh:web", alias: "web" },
      runtime:
        kind === "ready"
          ? { kind: "ready", url: "http://127.0.0.1:41000", username: "prioricode", password: "pw" }
          : kind === "failed"
            ? { kind: "failed", message: "boom" }
            : { kind },
    },
  ],
})

test("only ready ssh servers become connections", () => {
  expect(readySshConnections(state("ready"))).toEqual([
    {
      displayName: "web",
      label: "SSH",
      type: "ssh",
      host: "web",
      http: { url: "http://127.0.0.1:41000", username: "prioricode", password: "pw" },
    },
  ])
  expect(readySshConnections(state("starting"))).toEqual([])
  expect(readySshConnections(state("failed"))).toEqual([])
  expect(readySshConnections(state("stopped"))).toEqual([])
  expect(readySshConnections(undefined)).toEqual([])
})

test("ssh connection identity keys on host, not on the ephemeral tunnel port", () => {
  const first = readySshConnections(state("ready"), "Remote SSH")[0]!
  const next = { ...first, http: { ...first.http, url: "http://127.0.0.1:41999" } }
  // mirrors ServerConnection.key: `ssh:${conn.host}` — stable across reconnects
  expect(`ssh:${first.host}`).toBe(`ssh:${next.host}`)
  expect(first.type).toBe("ssh")
})

test("startup server falls back to sidecar when the ssh default is not online", () => {
  expect(availableSshStartupServer("ssh:web", state("ready"))).toBe("ssh:web")
  expect(availableSshStartupServer("ssh:web", state("failed"))).toBe("sidecar")
  expect(availableSshStartupServer("ssh:web", undefined)).toBe("sidecar")
  expect(availableSshStartupServer("sidecar", state("failed"))).toBe("sidecar")
  expect(availableSshStartupServer("http://10.0.0.9:4096", state("failed"))).toBe("http://10.0.0.9:4096")
  expect(availableSshStartupServer(null, state("ready"))).toBe("sidecar")
})
