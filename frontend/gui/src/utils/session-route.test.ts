import { describe, expect, test } from "bun:test"
import { base64Encode } from "@prioricode/core/util/encode"
import { ServerConnection } from "@/context/server"
import {
  legacySessionHref,
  legacySessionServer,
  requireServerKey,
  rootSession,
  serverKeyFromSegment,
  serverKeyLabel,
  serverRouteStatus,
  sessionHref,
} from "./session-route"

describe("session routes", () => {
  test("uses the unique persisted server for a legacy session route", () => {
    expect(
      legacySessionServer(
        [{ type: "session", server: ServerConnection.Key.make("server-b"), sessionId: "session-1" }],
        "session-1",
        ServerConnection.Key.make("server-a"),
      ),
    ).toBe(ServerConnection.Key.make("server-b"))
  })

  test("prefers the active server when a legacy session ID is ambiguous", () => {
    expect(
      legacySessionServer(
        [
          { type: "session", server: ServerConnection.Key.make("server-a"), sessionId: "session-1" },
          { type: "session", server: ServerConnection.Key.make("server-b"), sessionId: "session-1" },
        ],
        "session-1",
        ServerConnection.Key.make("server-b"),
      ),
    ).toBe(ServerConnection.Key.make("server-b"))
  })

  test("uses a server that actually holds the session when no tab exists", () => {
    expect(
      legacySessionServer([], "session-1", ServerConnection.Key.make("sidecar"), {
        owners: [ServerConnection.Key.make("ssh:web")],
      }),
    ).toBe(ServerConnection.Key.make("ssh:web"))
  })

  test("disambiguates ambiguous tabs with session owners", () => {
    expect(
      legacySessionServer(
        [
          { type: "session", server: ServerConnection.Key.make("server-a"), sessionId: "session-1" },
          { type: "session", server: ServerConnection.Key.make("server-b"), sessionId: "session-1" },
        ],
        "session-1",
        ServerConnection.Key.make("server-c"),
        { owners: [ServerConnection.Key.make("server-b")] },
      ),
    ).toBe(ServerConnection.Key.make("server-b"))
  })

  test("prefers the active server when several servers hold the session", () => {
    expect(
      legacySessionServer([], "session-1", ServerConnection.Key.make("server-a"), {
        owners: [ServerConnection.Key.make("server-b"), ServerConnection.Key.make("server-a")],
      }),
    ).toBe(ServerConnection.Key.make("server-a"))
  })

  test("uses a unique draft directory match when no tab or owner matches", () => {
    expect(
      legacySessionServer([], "session-1", ServerConnection.Key.make("sidecar"), {
        directory: "/remote/project",
        drafts: [{ server: ServerConnection.Key.make("ssh:web"), directory: "/remote/project" }],
      }),
    ).toBe(ServerConnection.Key.make("ssh:web"))
  })

  test("falls back to the active server without any signal", () => {
    expect(legacySessionServer([], "session-1", ServerConnection.Key.make("sidecar"))).toBe(
      ServerConnection.Key.make("sidecar"),
    )
  })

  test("builds and decodes a server-keyed session route", () => {
    const server = ServerConnection.Key.make("https://example.com:4096")
    const href = sessionHref(server, "session-1")

    expect(href).toBe("/server/aHR0cHM6Ly9leGFtcGxlLmNvbTo0MDk2/session/session-1")
    expect(requireServerKey(href.split("/")[2])).toBe(server)
  })

  test("rejects malformed server keys", () => {
    expect(() => requireServerKey("not-base64")).toThrow("Invalid server route")
  })

  test("parses a valid server key segment without throwing", () => {
    const server = ServerConnection.Key.make("https://example.com:4096")
    expect(serverKeyFromSegment(base64Encode(server))).toBe(server)
  })

  test("returns undefined for malformed or missing server key segments", () => {
    expect(serverKeyFromSegment("not-base64")).toBeUndefined()
    expect(serverKeyFromSegment("!!!")).toBeUndefined()
    expect(serverKeyFromSegment(undefined)).toBeUndefined()
  })

  test("derives a display label from a server key", () => {
    expect(serverKeyLabel(ServerConnection.Key.make("sidecar"))).toBe("Local")
    expect(serverKeyLabel(ServerConnection.Key.make("wsl:Ubuntu"))).toBe("Ubuntu")
    expect(serverKeyLabel(ServerConnection.Key.make("ssh:my-host"))).toBe("my-host")
    expect(serverKeyLabel(ServerConnection.Key.make("https://example.com:4096"))).toBe("example.com:4096")
    expect(serverKeyLabel(ServerConnection.Key.make("http://127.0.0.1:4096/"))).toBe("127.0.0.1:4096")
  })

  test("builds the legacy directory-keyed route", () => {
    expect(legacySessionHref("/Users/example/project", "session-1")).toBe(
      "/L1VzZXJzL2V4YW1wbGUvcHJvamVjdA/session/session-1",
    )
  })

  test("resolves the root session", async () => {
    const sessions: Record<string, { id: string; parentID?: string }> = {
      child: { id: "child", parentID: "parent" },
      parent: { id: "parent", parentID: "root" },
      root: { id: "root" },
    }

    expect(
      await rootSession(sessions.child, async (id) => {
        const session = sessions[id]
        if (!session) throw new Error(`Missing session: ${id}`)
        return session
      }),
    ).toBe(sessions.root)
  })

  test("rejects a parent cycle", async () => {
    const sessions: Record<string, { id: string; parentID?: string }> = {
      child: { id: "child", parentID: "parent" },
      parent: { id: "parent", parentID: "child" },
    }

    expect(rootSession(sessions.child, async (id) => sessions[id]!)).rejects.toThrow("Session parent cycle: child")
  })

  test("maps an invalid server route to the invalid key", () => {
    expect(serverRouteStatus("", undefined, { invalid: true, timedOut: false })).toEqual({
      key: "session.server.invalidRoute",
    })
  })

  test("surfaces the SSH reconnect attempt count", () => {
    expect(serverRouteStatus("web", { kind: "reconnecting", attempt: 3 }, { timedOut: false })).toEqual({
      key: "session.server.reconnecting",
      params: { server: "web", attempt: 3 },
    })
  })

  test("maps a failed SSH runtime to the unreachable wording", () => {
    expect(serverRouteStatus("web", { kind: "failed", message: "boom" }, { timedOut: false })).toEqual({
      key: "app.server.unreachable",
      params: { server: "web" },
    })
  })

  test("maps a stopped SSH runtime to the stopped key", () => {
    expect(serverRouteStatus("web", { kind: "stopped" }, { timedOut: false })).toEqual({
      key: "session.server.stopped",
      params: { server: "web" },
    })
  })

  test("shows connecting while an SSH server is starting", () => {
    expect(serverRouteStatus("web", { kind: "starting" }, { timedOut: false })).toEqual({
      key: "session.server.connecting",
      params: { server: "web" },
    })
  })

  test("falls back to connecting then unreachable without a known runtime", () => {
    expect(serverRouteStatus("web", undefined, { timedOut: false }).key).toBe("session.server.connecting")
    expect(serverRouteStatus("web", undefined, { timedOut: true }).key).toBe("app.server.unreachable")
  })
})
