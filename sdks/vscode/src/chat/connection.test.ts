import { describe, expect, it } from "bun:test"
import { createConnection } from "./connection"
import type { RawEvent } from "./types"

const frame = (event: RawEvent) => `data: ${JSON.stringify(event)}\n\n`

const base = { sessionID: "ses_1", timestamp: 0 }
const durable = (seq: number, type: string, data: Record<string, unknown>): RawEvent => ({
  id: `evt_d${seq}_${type}`,
  type,
  durable: { aggregateID: "ses_1", seq, version: 1 },
  data: { ...base, ...data },
})
const live = (id: string, type: string, data: Record<string, unknown>): RawEvent => ({
  id,
  type,
  data: { ...base, ...data },
})

interface StreamSpec {
  frames: string[]
  end: boolean
}

function harness(specs: Record<string, StreamSpec | ((route: string) => StreamSpec)>) {
  const events: RawEvent[] = []
  const routes: string[] = []
  let resyncCount = 0
  const openStream = async (route: string, signal: AbortSignal): Promise<Response> => {
    routes.push(route)
    const key = Object.keys(specs).find((candidate) => route.includes(candidate))
    const spec = key === undefined ? undefined : specs[key]
    const resolved = typeof spec === "function" ? spec(route) : spec ?? { frames: [], end: false }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of resolved.frames) controller.enqueue(new TextEncoder().encode(chunk))
        if (resolved.end) controller.close()
        signal.addEventListener("abort", () => {
          try {
            controller.error(new Error("aborted"))
          } catch {}
        })
      },
    })
    return { body, ok: true, status: 200 } as unknown as Response
  }
  const connection = createConnection({
    sessionID: "ses_1",
    openStream,
    onEvent: (event) => events.push(event),
    onResync: () => {
      resyncCount += 1
    },
    sleep: async () => {},
    random: () => 0.5,
    heartbeatTimeoutMs: 0,
  })
  return { connection, events, routes, resync: () => resyncCount }
}

const waitFor = async (predicate: () => boolean, message: string) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error("timeout waiting: " + message)
}

describe("connection", () => {
  it("replays durable events, drops stale seqs, forwards only session live fragments", async () => {
    const h = harness({
      "/event?after=": {
        frames: [
          frame(durable(1, "session.next.step.started", { assistantMessageID: "msg_a1" })),
          frame(durable(2, "session.next.text.ended", { assistantMessageID: "msg_a1", textID: "t1", text: "hi" })),
          frame(durable(2, "session.next.text.ended", { assistantMessageID: "msg_a1", textID: "t1", text: "hi" })),
        ],
        end: false,
      },
      "/api/event": {
        frames: [
          // durable events on the live stream are ignored (owned by the session stream)
          frame(durable(3, "session.next.step.ended", { assistantMessageID: "msg_a1" })),
          frame(live("evt_l1", "session.next.text.delta", { assistantMessageID: "msg_a1", textID: "t1", delta: "x" })),
          frame(live("evt_l1", "session.next.text.delta", { assistantMessageID: "msg_a1", textID: "t1", delta: "x" })),
          frame({ id: "evt_l2", type: "session.next.text.delta", data: { sessionID: "ses_other", delta: "y" } }),
        ],
        end: false,
      },
    })
    h.connection.start()
    await waitFor(() => h.events.length >= 3, "three events")
    await new Promise((resolve) => setTimeout(resolve, 10))
    h.connection.stop()

    expect(h.events.map((event) => event.type).sort()).toEqual(
      ["session.next.step.started", "session.next.text.delta", "session.next.text.ended"].sort(),
    )
    expect(h.connection.lastSeq()).toBe(2)
    expect(h.routes.find((route) => route.includes("/event?after="))).toContain("after=0")
  })

  it("resyncs pending requests on live connect", async () => {
    const h = harness({ "/api/event": { frames: [], end: false }, "/event?after=": { frames: [], end: false } })
    h.connection.start()
    await waitFor(() => h.resync() >= 1, "resync")
    h.connection.stop()
  })

  it("reconnects the durable stream from lastSeq after a clean end", async () => {
    let durableCalls = 0
    const h = harness({
      "/event?after=": (route) => {
        durableCalls += 1
        if (durableCalls === 1) {
          return {
            frames: [frame(durable(5, "session.next.step.started", { assistantMessageID: "msg_a1" }))],
            end: true,
          }
        }
        expect(route).toContain("after=5")
        return { frames: [], end: false }
      },
      "/api/event": { frames: [], end: false },
    })
    h.connection.start()
    await waitFor(() => durableCalls >= 2, "second durable connection")
    h.connection.stop()
    expect(h.connection.lastSeq()).toBe(5)
  })

  it("stops cleanly", async () => {
    const h = harness({ "/api/event": { frames: [], end: false }, "/event?after=": { frames: [], end: false } })
    h.connection.start()
    h.connection.stop()
    h.connection.stop()
    const before = h.events.length
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(h.events.length).toBe(before)
  })
})
