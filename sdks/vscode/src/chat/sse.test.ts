import { describe, expect, it } from "bun:test"
import { backoffDelay, parseJsonEvent, readSse, type SseEvent } from "./sse"

const streamOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })

const collect = async (chunks: string[]): Promise<SseEvent[]> => {
  const events: SseEvent[] = []
  await readSse(streamOf(chunks), (event) => events.push(event))
  return events
}

describe("readSse", () => {
  it("parses simple frames", async () => {
    const events = await collect(['data: {"type":"a"}\n\n', 'data: {"type":"b"}\n\n'])
    expect(events.map((event) => event.data)).toEqual(['{"type":"a"}', '{"type":"b"}'])
  })

  it("handles frames split across chunks and CRLF", async () => {
    const events = await collect(['data: {"ty', 'pe":"sp', 'lit"}\r\n\r', "\n: heartbeat\n\n", "data: tail\r\n"])
    expect(events.map((event) => event.data)).toEqual(['{"type":"split"}', "tail"])
  })

  it("ignores comment heartbeats and joins multi-line data", async () => {
    const events = await collect([": keepalive\n\n", "data: line1\ndata: line2\n\n"])
    expect(events).toEqual([{ event: undefined, data: "line1\nline2" }])
  })

  it("captures event names", async () => {
    const events = await collect(['event: message\ndata: {"x":1}\n\n'])
    expect(events[0]).toEqual({ event: "message", data: '{"x":1}' })
  })

  it("reports transport activity for comment-only frames (heartbeat liveness)", async () => {
    let activities = 0
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent < 2) {
          sent += 1
          setTimeout(() => controller.enqueue(new TextEncoder().encode(": heartbeat\n\n")), 10)
        }
      },
    })
    await readSse(stream, () => {}, {
      onActivity: () => (activities += 1),
      stop: () => activities >= 2,
    })
    expect(activities).toBeGreaterThanOrEqual(2)
  })

  it("stops cooperatively on a never-ending stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":1}\n\n'))
      },
    })
    const events: SseEvent[] = []
    await readSse(stream, (event) => events.push(event), { stop: () => events.length >= 1 })
    expect(events).toHaveLength(1)
  })
})

describe("parseJsonEvent", () => {
  it("returns undefined for malformed payloads", () => {
    expect(parseJsonEvent("not json")).toBeUndefined()
    expect(parseJsonEvent('{"ok":true}')).toEqual({ ok: true })
  })
})

describe("backoffDelay", () => {
  it("grows exponentially and caps", () => {
    const fixed = backoffDelay(0, { random: () => 1 })
    expect(fixed).toBe(500)
    expect(backoffDelay(1, { random: () => 1 })).toBe(1000)
    expect(backoffDelay(20, { random: () => 1, cap: 15_000 })).toBe(15_000)
    expect(backoffDelay(3, { random: () => 0 })).toBe(2000)
  })
})
