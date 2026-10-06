import { describe, expect, it } from "bun:test"
import { createBridge } from "./bridge"
import { createBridgeHost } from "../../../../../sdks/vscode/src/chat/bridge"
import { createGuiClient } from "./client"

/**
 * Wire-conformance between the two independently written halves of the bridge:
 * the GUI webview shim (this package) and the extension host relay (sdks/vscode).
 * If these drift, the extension ships broken; this test is the fence.
 */
function wired(options?: {
  serverResult?:
    | { ok: true; server: { url: string; username: string; password?: string } }
    | { ok: false; reason: "offline"; detail?: string }
  upstream?: (url: string, init: RequestInit) => Promise<Response>
  getSelection?: () => Promise<{ path: string; start: number; end: number; text?: string } | undefined>
}) {
  const webviewListeners: ((message: unknown) => void)[] = []
  const hostCalls: { method: string; url: string; headers: Record<string, string>; body?: string }[] = []
  const resolver = options?.serverResult ?? {
    ok: true as const,
    server: { url: "http://daemon.local", username: "prioricode", password: "pw-123" },
  }

  const host = createBridgeHost({
    post: (message) => {
      queueMicrotask(() => {
        for (const listener of webviewListeners) listener(message)
      })
    },
    resolveServer: async () => resolver,
    directory: () => "/work/tree",
    getSelection: options?.getSelection,
    coalesceMs: 1,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      hostCalls.push({
        method: String(init?.method ?? "GET"),
        url,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: typeof init?.body === "string" ? init.body : undefined,
      })
      if (options?.upstream) return options.upstream(url, init ?? {})
      return new Response(JSON.stringify({ id: "ses_pair" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch,
  })

  const api = {
    postMessage: (message: unknown) => {
      queueMicrotask(() => host.onMessage(message))
    },
  }
  const bridge = createBridge({
    api,
    subscribe: (listener) => {
      webviewListeners.push(listener)
      return () => {
        const at = webviewListeners.indexOf(listener)
        if (at >= 0) webviewListeners.splice(at, 1)
      }
    },
  })
  return { host, bridge, hostCalls }
}

const sseUpstream = (frames: string[], onAbort?: () => void) => (_url: string, init: RequestInit) =>
  Promise.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          let i = 0
          const pump = () => {
            if (init.signal?.aborted) {
              onAbort?.()
              try {
                controller.error(new Error("aborted"))
              } catch {}
              return
            }
            if (i < frames.length) controller.enqueue(new TextEncoder().encode(frames[i++]))
            setTimeout(pump, 2)
          }
          pump()
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ),
  )

describe("bridge pair conformance (gui shim <-> extension host relay)", () => {
  it("completes the config handshake without leaking credentials", async () => {
    const { bridge } = wired()
    const config = await bridge.target()
    expect(config).toMatchObject({ status: "ready", baseUrl: "http://daemon.local", directory: "/work/tree" })
    expect(JSON.stringify(config)).not.toContain("pw-123")
  })

  it("relays a typed client request with host-owned auth and stripped webview headers", async () => {
    const upstream = async (url: string) =>
      url.includes("/api/health")
        ? new Response(JSON.stringify({ healthy: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response("{}", { status: 404, headers: { "content-type": "application/json" } })
    const { bridge, hostCalls } = wired({ upstream })
    const config = await bridge.target()
    const client = createGuiClient({
      baseUrl: config.baseUrl,
      fetch: bridge.fetch,
      headers: { authorization: "Basic EVIL", origin: "https://evil.example" },
    })
    const health = await client.health.get()
    expect(health).toEqual({ healthy: true })
    expect(hostCalls[0]?.url).toBe("http://daemon.local/api/health")
    expect(hostCalls[0]?.headers.authorization).toBe(`Basic ${btoa("prioricode:pw-123")}`)
    expect(hostCalls[0]?.headers.origin).toBeUndefined()
  })

  it("carries prompt bodies through the relay", async () => {
    const { bridge, hostCalls } = wired()
    const config = await bridge.target()
    const client = createGuiClient({ baseUrl: config.baseUrl, fetch: bridge.fetch })
    await client.sessions.create({ location: { directory: "/work/tree" } })
    expect(hostCalls[0]?.method).toBe("POST")
    expect(hostCalls[0]?.url).toBe("http://daemon.local/api/session")
    expect(JSON.parse(hostCalls[0]?.body ?? "{}")).toEqual({ location: { directory: "/work/tree" } })
  })

  it("streams durable SSE frames into the client iterable and propagates abort", async () => {
    let seenAbort = false
    const upstream = sseUpstream(
      [
        'data: {"id":"e1","type":"session.next.text.ended","durable":{"aggregateID":"ses_x","seq":1,"version":1},"data":{"sessionID":"ses_x","assistantMessageID":"msg_a1","textID":"t1","text":"settled"}}\n\n',
        ": heartbeat\n\n",
      ],
      () => {
        seenAbort = true
      },
    )
    const { bridge } = wired({ upstream })
    const config = await bridge.target()
    const client = createGuiClient({ baseUrl: config.baseUrl, fetch: bridge.fetch })
    const controller = new AbortController()
    const collected: unknown[] = []
    let first = true
    try {
      for await (const event of client.sessions.events({ sessionID: "ses_x" }, { signal: controller.signal })) {
        collected.push(event)
        if (first) {
          first = false
          controller.abort()
        }
      }
    } catch {
      // Aborting a stream surfaces as a transport failure; that is the expected exit.
    }
    expect(collected.length).toBe(1)
    expect((collected[0] as { data?: { text?: string } }).data?.text).toBe("settled")
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(seenAbort).toBe(true)
  })

  it("surfaces host-side 503 when discovery has no server", async () => {
    const { bridge } = wired({ serverResult: { ok: false, reason: "offline", detail: "daemon down" } })
    const client = createGuiClient({ baseUrl: "http://daemon.local", fetch: bridge.fetch })
    await expect(client.health.get()).rejects.toMatchObject({ reason: "UnexpectedStatus", cause: { status: 503 } })
  })

  it("refuses non-/api paths at the host boundary", async () => {
    const { bridge, hostCalls } = wired()
    await bridge.target()
    const response = await bridge.fetch("http://daemon.local/etc/passwd")
    expect(response.status).toBe(400)
    expect(hostCalls.length).toBe(0)
  })

  it("round-trips an editor selection through the host", async () => {
    const { bridge } = wired({ getSelection: async () => ({ path: "src/a.ts", start: 3, end: 7 }) })
    await bridge.target()
    const selection = await bridge.requestSelection()
    expect(selection).toEqual({ path: "src/a.ts", start: 3, end: 7, text: undefined })
  })

  it("resolves undefined selection when the host has no editor", async () => {
    const { bridge } = wired({ getSelection: async () => undefined })
    await bridge.target()
    expect(await bridge.requestSelection()).toBeUndefined()
  })

  it("relays a PTY socket with ticket minted host-side and bidirectional frames", async () => {
    let capturedUrl = ""
    let push: ((data: Uint8Array, isBinary: boolean) => void) | undefined
    let close: ((code: number) => void) | undefined
    let sent: Uint8Array | undefined
    const upstream = async (url: string) =>
      url.includes("/connect-token")
        ? new Response(JSON.stringify({ location: {}, data: { ticket: "tk-1", expires_in: 60 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response("{}", { status: 404, headers: { "content-type": "application/json" } })
    const webviewListeners: ((message: unknown) => void)[] = []
    const host = createBridgeHost({
      post: (message) => {
        queueMicrotask(() => {
          for (const listener of webviewListeners) listener(message)
        })
      },
      resolveServer: async () => ({
        ok: true,
        server: { url: "http://daemon.local", username: "prioricode", password: "pw-123" },
      }),
      directory: () => "/work/tree",
      coalesceMs: 1,
      openWebSocket: async (url) => {
        capturedUrl = url
        return {
          send: () => {},
          sendBinary: (data) => {
            sent = data
          },
          onMessage: (handler) => {
            push = handler
          },
          onClose: (handler) => {
            close = handler
          },
          close: () => close?.(1000),
        }
      },
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) =>
        upstream(String(input))) as unknown as typeof fetch,
    })
    const bridge = createBridge({
      api: { postMessage: (message) => void queueMicrotask(() => host.onMessage(message)) },
      subscribe: (listener) => {
        webviewListeners.push(listener)
        return () => {}
      },
    })
    await bridge.target()
    const output: number[] = []
    const channel = await bridge.requestPty({ ptyID: "p_1", cursor: 42, onData: (bytes) => output.push(...bytes) })
    expect(channel).toBeDefined()
    expect(capturedUrl).toContain("/api/pty/p_1/connect?")
    expect(capturedUrl).toContain("ticket=tk-1")
    expect(capturedUrl).toContain("cursor=42")
    expect(capturedUrl).toContain("location%5Bdirectory%5D=%2Fwork%2Ftree")
    push?.(new TextEncoder().encode("hello-term"), true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(output).toEqual(Array.from(new TextEncoder().encode("hello-term")))
    channel!.send(new TextEncoder().encode("ls\n"))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(new TextDecoder().decode(sent)).toBe("ls\n")
    const closedAt = channel!.closed
    close?.(1000)
    expect(await closedAt).toBe(1000)
    host.dispose()
    bridge.dispose()
  })
})

describe("host relay stream guards", () => {
  it("refuses open frames for non-SSE routes and ends with an error", async () => {
    const posted: unknown[] = []
    const host = createBridgeHost({
      post: (message: unknown) => posted.push(message),
      resolveServer: async () => ({ ok: true, server: { url: "http://daemon.local", username: "prioricode" } }),
      directory: () => undefined,
      fetchImpl: (async () => new Response("no")) as unknown as typeof fetch,
    })
    host.onMessage({ kind: "open", id: "s1", path: "/api/session/ses_x/history" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(posted).toEqual([{ kind: "end", id: "s1", error: "stream path not allowed" }])
    host.dispose()
  })

  it("pumps a non-OK stream body so declared errors survive the relay", async () => {
    const posted: unknown[] = []
    const host = createBridgeHost({
      post: (message: unknown) => posted.push(message),
      resolveServer: async () => ({ ok: true, server: { url: "http://daemon.local", username: "prioricode" } }),
      directory: () => undefined,
      coalesceMs: 1,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ _tag: "SessionNotFoundError", sessionID: "ses_z", message: "gone" }), {
          status: 404,
          headers: { "content-type": "text/event-stream" },
        })) as unknown as typeof fetch,
    })
    host.onMessage({ kind: "open", id: "s2", path: "/api/session/ses_z/event" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const kinds = posted.map((frame) => (frame as { kind?: string }).kind)
    expect(kinds).toContain("open-head")
    expect(kinds).toContain("chunk")
    expect(kinds).toContain("end")
    const head = posted.find((frame) => (frame as { kind?: string }).kind === "open-head") as { status: number }
    expect(head.status).toBe(404)
    host.dispose()
  })
})
