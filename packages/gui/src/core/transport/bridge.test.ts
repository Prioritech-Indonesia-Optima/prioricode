import { describe, expect, it } from "bun:test"
import { createBridge, type BridgeOutbound } from "./bridge"
import { createGuiClient } from "./client"

interface FakeHostOptions {
  routes?: Record<string, { status: number; body: unknown }>
  sseChunks?: string[]
}

/** Minimal extension-host counterpart of the bridge wire protocol. */
function fakeHost(options: FakeHostOptions & { directory?: string }) {
  const listeners: ((message: unknown) => void)[] = []
  const cancels: string[] = []
  const requests: string[] = []
  const opens: string[] = []
  let streamPump: ((push: (data: string) => void, finish: (error?: string) => void) => void) | undefined
  const api = {
    postMessage: (message: unknown) => {
      const frame = message as BridgeOutbound
      queueMicrotask(() => dispatch(frame))
    },
  }
  const toWebview = (message: unknown) => {
    for (const listener of listeners) listener(message)
  }

  const dispatch = async (frame: BridgeOutbound) => {
    if (frame.kind === "ready") {
      toWebview({
        kind: "config",
        status: "ready",
        baseUrl: "http://prioricode.local",
        directory: options.directory ?? "/repo",
      })
      return
    }
    if (frame.kind === "cancel") {
      cancels.push(frame.id)
      return
    }
    if (frame.kind === "req") {
      requests.push(`${frame.method} ${frame.path}`)
      const match = options.routes?.[frame.path.split("?")[0] ?? ""] ?? { status: 404, body: { _tag: "NoRoute" } }
      toWebview({
        kind: "res",
        id: frame.id,
        status: match.status,
        headers: { "content-type": "application/json" },
        text: JSON.stringify(match.body),
      })
      return
    }
    if (frame.kind === "open") {
      opens.push(frame.path)
      toWebview({ kind: "open-head", id: frame.id, status: 200, headers: { "content-type": "text/event-stream" } })
      const chunks = options.sseChunks ?? []
      let index = 0
      streamPump = undefined
      while (index < chunks.length) {
        if (cancels.includes(frame.id)) return
        const chunk = chunks[index]
        index += 1
        const bytes = new TextEncoder().encode(chunk)
        let binary = ""
        for (const byte of bytes) binary += String.fromCharCode(byte)
        toWebview({ kind: "chunk", id: frame.id, dataBase64: btoa(binary) })
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      if (!cancels.includes(frame.id)) toWebview({ kind: "end", id: frame.id })
      return
    }
  }

  return {
    api,
    subscribe: (listener: (message: unknown) => void) => {
      listeners.push(listener)
      return () => {
        const at = listeners.indexOf(listener)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
    requests,
    opens,
    cancels,
    streamPump: () => streamPump,
  }
}

describe("bridge transport", () => {
  it("performs a typed client request through the host relay", async () => {
    const host = fakeHost({ routes: { "/api/health": { status: 200, body: { healthy: true } } } })
    const bridge = createBridge({ api: host.api, subscribe: host.subscribe })
    const client = createGuiClient({ baseUrl: "http://prioricode.local", fetch: bridge.fetch })
    const config = await bridge.target()
    expect(config).toMatchObject({ status: "ready", baseUrl: "http://prioricode.local", directory: "/repo" })
    const health = await client.health.get()
    expect(health).toEqual({ healthy: true })
    expect(host.requests).toContain("GET /api/health")
  })

  it("streams SSE through chunk frames into the client async iterable", async () => {
    const sseChunks = [
      'data: {"id":"a","type":"server.connected","data":{}}\n\n',
      'data: {"id":"b","type":"session.next.text.delta","properties":{"sessionID":"ses_1","delta":"x"}}\n',
      "partial\n",
      ': heartbeat\n\ndata: {"id":"c"',
      ',"type":"x"}\n\n',
    ]
    const host = fakeHost({ sseChunks })
    const bridge = createBridge({ api: host.api, subscribe: host.subscribe })
    const client = createGuiClient({ baseUrl: "http://prioricode.local", fetch: bridge.fetch })
    await bridge.target()
    const seen: string[] = []
    for await (const event of client.events.subscribe()) {
      seen.push(event.type)
    }
    expect(seen).toEqual(["server.connected", "session.next.text.delta", "x"])
    expect(host.opens.find((path) => path.startsWith("/api/event"))).toBeDefined()
  })

  it("propagates abort signal to a host cancel", async () => {
    const endless = {
      sseChunks: ['data: {"id":"a","type":"t","data":{}}\n\n'].concat(Array.from({ length: 200 }, () => ": pings\n\n")),
    }
    const host = fakeHost(endless)
    const bridge = createBridge({ api: host.api, subscribe: host.subscribe })
    const client = createGuiClient({ baseUrl: "http://prioricode.local", fetch: bridge.fetch })
    await bridge.target()
    const controller = new AbortController()
    let count = 0
    const iterator = client.events.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
    const first = await iterator.next()
    count += 1
    expect(first.done).toBe(false)
    controller.abort()
    await expect(iterator.next()).rejects.toThrow()
    expect(count).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(host.cancels.length).toBeGreaterThan(0)
  })

  it("routes non-event paths as plain requests and event paths as streams", async () => {
    const host = fakeHost({ routes: { "/api/session": { status: 200, body: { data: [], cursor: {} } } } })
    const bridge = createBridge({ api: host.api, subscribe: host.subscribe })
    const client = createGuiClient({ baseUrl: "http://prioricode.local", fetch: bridge.fetch })
    await bridge.target()
    const page = await client.sessions.list()
    expect(page.data).toEqual([])
    expect(host.requests).toContain("GET /api/session")
    expect(host.opens.length).toBe(0)
  })
})
