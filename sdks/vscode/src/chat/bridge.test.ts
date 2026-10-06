import { describe, expect, it } from "bun:test"
import { createBridgeHost } from "./bridge"

function harness(
  result: Awaited<ReturnType<typeof createResolver>>,
  upstream?: (url: string, init: RequestInit) => Promise<Response>,
) {
  const posted: unknown[] = []
  const calls: { url: string; method: string; headers: Record<string, string> }[] = []
  const host = createBridgeHost({
    post: (message) => posted.push(message),
    resolveServer: createResolver(result),
    directory: () => "/tmp/work",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        method: String(init?.method ?? "GET"),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      })
      if (upstream) return upstream(url, init ?? {})
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch,
  })
  return { host, posted, calls }
}

const createResolver =
  (
    result:
      | { ok: true; server: { url: string; username: string; password?: string } }
      | { ok: false; reason: "offline" | "auth-mismatch" | "no-cli"; detail?: string },
  ) =>
  async () =>
    result

describe("bridge host relay", () => {
  it("answers ready with config containing no secret material", async () => {
    const { host, posted } = harness({
      ok: true,
      server: { url: "http://127.0.0.1:4096", username: "prioricode", password: "sekret" },
    })
    host.onMessage({ kind: "ready" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(posted).toEqual([
      {
        kind: "config",
        status: "ready",
        baseUrl: "http://127.0.0.1:4096",
        directory: "/tmp/work",
        serverLabel: undefined,
      },
    ])
    expect(JSON.stringify(posted)).not.toContain("sekret")
    host.dispose()
  })

  it("rejects non-/api paths without calling upstream", async () => {
    const { host, posted, calls } = harness({ ok: true, server: { url: "http://x" } })
    host.onMessage({ kind: "req", id: "r1", method: "GET", path: "/../../etc/passwd" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(calls.length).toBe(0)
    expect(posted[0]).toMatchObject({ kind: "res", id: "r1", status: 400 })
    host.dispose()
  })

  it("answers 503 tagged failure while discovery is down", async () => {
    const { host, posted } = harness({ ok: false, reason: "offline", detail: "down" })
    host.onMessage({ kind: "req", id: "r2", method: "GET", path: "/api/health" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(posted[0]).toMatchObject({ kind: "res", id: "r2", status: 503 })
    host.dispose()
  })

  it("injects host auth and preserves request bodies", async () => {
    const { host, calls } = harness({ ok: true, server: { url: "http://srv", username: "prioricode", password: "pw" } })
    host.onMessage({
      kind: "req",
      id: "r3",
      method: "POST",
      path: "/api/session",
      headers: { "content-type": "application/json", authorization: "Basic HACK" },
      body: '{"x":1}',
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from("prioricode:pw").toString("base64")}`)
    host.dispose()
  })
})
