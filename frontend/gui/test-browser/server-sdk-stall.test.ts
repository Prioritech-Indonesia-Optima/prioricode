import { afterEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { Platform } from "@/context/platform"
import { createServerSdkContext, streamTiming, type ServerSDK } from "@/context/server-sdk"
import { ServerScope } from "@/utils/server-scope"
import { ServerConnection } from "@/context/server"

type Attempt = {
  index: number
  controller: ReadableStreamDefaultController<Uint8Array> | undefined
  aborted: boolean
}

const originalFetch = globalThis.fetch
const originalConsoleError = console.error
const originalTiming = { ...streamTiming }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
  Object.assign(streamTiming, originalTiming)
})

function frame(event: Record<string, unknown>) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

function harness(options: { scripts: ("hang" | "end")[] }) {
  const attempts: Attempt[] = []
  const received: Array<{ directory: string; type: string }> = []
  const consoleErrors: unknown[][] = []
  let pending = 0

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url)
    if (url.pathname === "/api/event") {
      const behavior = options.scripts[pending] ?? "hang"
      pending += 1
      const attempt: Attempt = { index: pending, controller: undefined, aborted: false }
      attempts.push(attempt)
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          attempt.controller = controller
          controller.enqueue(frame({ id: `connected-${attempt.index}`, type: "server.connected", data: {} }))
          if (behavior === "end") controller.close()
        },
        cancel() {
          attempt.aborted = true
        },
      })
      // Mirror real fetch semantics: aborting the signal errors the body stream.
      init?.signal?.addEventListener("abort", () => {
        attempt.aborted = true
        try {
          attempt.controller?.error(new Error("simulated half-open socket abort"))
        } catch {}
      })
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })
    }
    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ pid: 4242 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response("not found", { status: 404 })
  }) as typeof globalThis.fetch

  console.error = (...args: unknown[]) => {
    consoleErrors.push(args)
  }

  const connection: ServerConnection.Any = {
    type: "sidecar",
    variant: "base",
    http: { url: "http://127.0.0.1:45999", username: "prioricode", password: "test-password" },
  }

  let sdk!: ServerSDK
  const disposeRoot = createRoot((dispose) => {
    sdk = createServerSdkContext(connection, ServerScope.local, { platform: "web" } as unknown as Platform)
    return dispose
  })

  sdk.event.listen((payload) => {
    const wrapper = payload as unknown as { name?: string; details?: { type?: string } }
    received.push({ type: wrapper.details?.type ?? "", directory: String(wrapper.name ?? "") })
  })

  return {
    attempts,
    received,
    consoleErrors,
    sdk: () => sdk,
    dispose: () => {
      disposeRoot()
      globalThis.fetch = originalFetch
      console.error = originalConsoleError
    },
  }
}

describe("event stream stall watchdog (sleep/wake recovery)", () => {
  test("half-open stream is detected as stalled and re-subscribed", async () => {
    Object.assign(streamTiming, { reconnectMs: 15, stallMs: 60, stallCheckMs: 10 })
    const h = harness({ scripts: ["hang", "hang"] })

    void h.sdk().event.start()
    await sleep(30)
    expect(h.attempts).toHaveLength(1)
    expect(h.received.filter((event) => event.type === "server.connected")).toHaveLength(1)

    // Simulate sleep: the loopback socket stays half-open — no frames, no close.
    // The watchdog must abort the stalled attempt and re-subscribe.
    await sleep(300)
    expect(h.attempts[0]?.aborted).toBe(true)
    expect(h.attempts.length).toBeGreaterThanOrEqual(2)
    expect(h.received.filter((event) => event.type === "server.connected").length).toBeGreaterThanOrEqual(2)

    // A watchdog abort is a clean close, not a failure: nothing may be logged.
    expect(h.consoleErrors.filter((args) => String(args[0]).includes("event stream failed"))).toHaveLength(0)

    h.dispose()
  })

  test("clean stream end also reconnects and keeps the default live-only semantics", async () => {
    Object.assign(streamTiming, { reconnectMs: 15, stallMs: 60, stallCheckMs: 10 })
    const h = harness({ scripts: ["end", "hang"] })

    void h.sdk().event.start()
    await sleep(300)
    // The first stream closed by itself; the loop re-subscribed at least once.
    expect(h.attempts.length).toBeGreaterThanOrEqual(2)
    expect(h.received.filter((event) => event.type === "server.connected").length).toBeGreaterThanOrEqual(2)

    h.dispose()
  })

  test("healthy heartbeating stream never re-subscribes", async () => {
    Object.assign(streamTiming, { reconnectMs: 15, stallMs: 150, stallCheckMs: 10 })
    const h = harness({ scripts: ["hang"] })

    void h.sdk().event.start()
    await sleep(30)
    expect(h.attempts).toHaveLength(1)

    // Server keepalive frames keep the stream fresh well inside the stall window.
    for (let round = 0; round < 8; round++) {
      h.attempts[0]?.controller?.enqueue(frame({ id: `hb-${round}`, type: "server.heartbeat", data: {} }))
      await sleep(25)
    }
    expect(h.attempts).toHaveLength(1)
    expect(h.attempts[0]?.aborted).toBe(false)
    expect(h.received.filter((event) => event.type === "server.heartbeat").length).toBeGreaterThanOrEqual(6)

    // A wake event on a still-fresh stream must not trigger a re-subscribe.
    window.dispatchEvent(new Event("online"))
    await sleep(100)
    expect(h.attempts).toHaveLength(1)
    expect(h.attempts[0]?.aborted).toBe(false)

    h.dispose()
  })

  test("wake event re-arms a stalled stream before the watchdog tick", async () => {
    Object.assign(streamTiming, { reconnectMs: 15, stallMs: 60, stallCheckMs: 10_000 })
    const h = harness({ scripts: ["hang", "hang"] })

    void h.sdk().event.start()
    await sleep(30)
    expect(h.attempts).toHaveLength(1)

    // Stall threshold exceeded, but the watchdog check (10s away) has not run.
    await sleep(120)
    expect(h.attempts).toHaveLength(1)
    expect(h.attempts[0]?.aborted).toBe(false)

    // The desktop renderer dispatches "online" on powerMonitor resume; the GUI
    // must re-subscribe immediately instead of waiting for the watchdog.
    window.dispatchEvent(new Event("online"))
    await sleep(100)
    expect(h.attempts).toHaveLength(2)
    expect(h.attempts[0]?.aborted).toBe(true)

    h.dispose()
  })
})
