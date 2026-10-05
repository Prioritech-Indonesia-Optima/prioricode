import { parseJsonEvent, readSse, backoffDelay } from "./sse"
import { normalizeEvent, type RawEvent } from "./events/normalize"

export interface ConnectionOptions {
  sessionID: string
  openStream: (route: string, signal: AbortSignal) => Promise<Response>
  onEvent: (event: RawEvent) => void
  onResync?: () => void | Promise<void>
  onError?: (error: unknown, scope: "durable" | "live") => void
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  heartbeatTimeoutMs?: number
  /**
   * The durable per-session stream carries no heartbeat, so a dead-but-open
   * connection is indistinguishable from an idle session by reading alone.
   * Reconnect cooperatively after this much silence; replay from lastSeq makes
   * it cheap and idempotent. 0 disables.
   */
  durableIdleMs?: number
}

export interface Connection {
  start: () => void
  stop: () => void
  lastSeq: () => number
}

const MAX_LIVE_SEEN = 2000

export function createConnection(options: ConnectionOptions): Connection {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const random = options.random ?? Math.random
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 45_000
  const sessionID = options.sessionID
  const seenLive = new Set<string>()
  let stopped = true
  let lastSeq = 0
  let durableController: AbortController | undefined
  let liveController: AbortController | undefined

  const trimSeen = () => {
    if (seenLive.size <= MAX_LIVE_SEEN) return
    for (const id of seenLive) {
      seenLive.delete(id)
      if (seenLive.size <= MAX_LIVE_SEEN / 2) break
    }
  }

  const belongsToSession = (event: RawEvent): boolean => {
    if (event.durable) return event.durable.aggregateID === sessionID
    const data = event.data as { sessionID?: unknown } | undefined
    return typeof data?.sessionID === "string" ? data.sessionID === sessionID : false
  }

  const decode = (raw: string): RawEvent | undefined => normalizeEvent(parseJsonEvent(raw))

  async function durableLoop(): Promise<void> {
    let attempt = 0
    while (!stopped) {
      const controller = new AbortController()
      durableController = controller
      let lastActivity = Date.now()
      let watchdogFired = false
      const idleMs = options.durableIdleMs ?? 30_000
      const watchdog =
        idleMs > 0
          ? setInterval(() => {
              if (Date.now() - lastActivity > idleMs) {
                watchdogFired = true
                controller.abort()
              }
            }, Math.max(250, Math.floor(idleMs / 3)))
          : undefined
      try {
        const response = await options.openStream(
          `/api/session/${encodeURIComponent(sessionID)}/event?after=${lastSeq}`,
          controller.signal,
        )
        attempt = 0
        await readSse(
          response.body as ReadableStream<Uint8Array>,
          (frame) => {
            const event = decode(frame.data)
            if (!event) return
            const seq = event.durable?.seq
            if (typeof seq === "number") {
              if (seq <= lastSeq) return
              lastSeq = seq
            }
            options.onEvent(event)
          },
          { onActivity: () => (lastActivity = Date.now()) },
        )
      } catch (error) {
        if (stopped) return
        options.onError?.(watchdogFired ? new Error("durable stream idle timeout") : error, "durable")
      } finally {
        if (watchdog !== undefined) clearInterval(watchdog)
      }
      if (stopped) return
      await sleep(backoffDelay(attempt, { random }))
      attempt += 1
    }
  }

  async function liveLoop(): Promise<void> {
    let attempt = 0
    while (!stopped) {
      const controller = new AbortController()
      liveController = controller
      let watchdogFired = false
      let lastActivity = Date.now()
      const watchdog =
        heartbeatTimeoutMs > 0
          ? setInterval(() => {
              if (Date.now() - lastActivity > heartbeatTimeoutMs) {
                watchdogFired = true
                controller.abort()
              }
            }, Math.max(250, Math.floor(heartbeatTimeoutMs / 3)))
          : undefined
      try {
        const response = await options.openStream("/api/event", controller.signal)
        attempt = 0
        await options.onResync?.()
        await readSse(
          response.body as ReadableStream<Uint8Array>,
          (frame) => {
            const event = decode(frame.data)
            if (!event) return
            // Durable events are owned by the per-session stream; the live
            // stream only carries live-only fragments (deltas, asks).
            if (event.durable) return
            if (!belongsToSession(event)) return
            if (typeof event.id === "string") {
              if (seenLive.has(event.id)) return
              seenLive.add(event.id)
              trimSeen()
            }
            options.onEvent(event)
          },
          { onActivity: () => (lastActivity = Date.now()) },
        )
      } catch (error) {
        if (stopped) return
        options.onError?.(watchdogFired ? new Error("live stream heartbeat timeout") : error, "live")
      } finally {
        if (watchdog !== undefined) clearInterval(watchdog)
      }
      if (stopped) return
      await sleep(backoffDelay(attempt, { random }))
      attempt += 1
    }
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      void durableLoop()
      void liveLoop()
    },
    stop() {
      stopped = true
      durableController?.abort()
      liveController?.abort()
    },
    lastSeq() {
      return lastSeq
    },
  }
}
