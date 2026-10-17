import { describe, expect, test } from "bun:test"
import { startSidecarWatchdog } from "./sidecar-watchdog"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function setup(options?: { restartError?: Error | null; intervalMs?: number }) {
  const clock = {
    time: 1_000_000,
    now() {
      return this.time
    },
    advance(ms: number) {
      this.time += ms
    },
  }
  const state = {
    healthy: true,
    probes: 0,
    restarts: [] as number[],
    restartError: options?.restartError ?? null,
    alternating: false,
    quitting: false,
  }
  const logs: Array<{ message: string; meta?: Record<string, unknown> }> = []

  const watchdog = startSidecarWatchdog({
    probe: async () => {
      state.probes += 1
      if (state.alternating && state.probes % 2 === 1) return false
      return state.healthy
    },
    restart: async () => {
      state.restarts.push(clock.now())
      if (state.restartError) throw state.restartError
      state.healthy = true
    },
    isQuitting: () => state.quitting,
    log: (message, meta) => logs.push({ message, meta }),
    now: () => clock.now(),
    intervalMs: options?.intervalMs ?? 2,
    maxConsecutiveFailures: 2,
    restartBaseMs: 1_000,
    restartMaxMs: 8_000,
    healthyResetMs: 5_000,
  })

  const pump = async (steps: number, ms = 100) => {
    for (let index = 0; index < steps; index++) {
      clock.advance(ms)
      await sleep(6)
    }
  }

  return { clock, state, logs, watchdog, pump }
}

describe("sidecar watchdog", () => {
  test("healthy sidecar is never restarted", async () => {
    const h = setup()
    await h.pump(5)
    expect(h.state.restarts).toHaveLength(0)
    expect(h.state.probes).toBeGreaterThan(0)
    h.watchdog.stop()
  })

  test("sidecar that dies (e.g. killed during sleep) is restarted and recovers", async () => {
    const h = setup()
    await h.pump(3)
    expect(h.state.restarts).toHaveLength(0)

    h.state.healthy = false
    await h.pump(3)
    expect(h.state.restarts).toHaveLength(1)
    expect(h.logs.map((log) => log.message)).toContain("sidecar unhealthy, restarting")
    expect(h.logs.map((log) => log.message)).toContain("sidecar restarted")

    // Healthy again: stays up, no duplicate restarts.
    await h.pump(5)
    expect(h.state.restarts).toHaveLength(1)
    h.watchdog.stop()
  })

  test("a single transient probe blip does not restart", async () => {
    const h = setup()
    h.state.alternating = true
    await h.pump(6)
    expect(h.state.restarts).toHaveLength(0)
    expect(h.logs.map((log) => log.message)).not.toContain("sidecar unhealthy, restarting")
    h.watchdog.stop()
  })

  test("restart spacing escalates and caps when the restart keeps failing", async () => {
    const h = setup({ restartError: new Error("EADDRINUSE") })
    h.state.healthy = false

    for (let step = 0; h.state.restarts.length < 5 && step < 200; step++) {
      h.clock.advance(100)
      await sleep(6)
    }

    const gaps = h.state.restarts.slice(1).map((time, index) => time - h.state.restarts[index]!)
    expect(gaps).toEqual([1_000, 2_000, 4_000, 8_000])
    expect(h.logs.map((log) => log.message)).toContain("sidecar restart failed")
    h.watchdog.stop()
  })

  test("after stability returns, the restart backoff resets", async () => {
    const h = setup({ restartError: new Error("EADDRINUSE") })
    h.state.healthy = false

    // Drive the backoff to its 8s cap: restarts at +1s, +2s, +4s (delay is now 8000).
    for (let step = 0; h.state.restarts.length < 4 && step < 200; step++) {
      h.clock.advance(100)
      await sleep(6)
    }
    expect(h.state.restarts.length).toBeGreaterThanOrEqual(4)

    // Sidecar comes back and stays healthy past the reset window.
    h.state.restartError = null
    h.state.healthy = true
    await h.pump(55, 100)

    // Fail again: the backoff must have reset, so a restart lands quickly —
    // with the un-reset 8s spacing this would not happen within the pump.
    const before = h.state.restarts.length
    h.state.healthy = false
    await h.pump(4, 100)
    expect(h.state.restarts.length).toBe(before + 1)
    h.watchdog.stop()
  })

  test("never probes or restarts while quitting, and stop() is final", async () => {
    const h = setup()
    h.state.quitting = true
    await h.pump(5)
    expect(h.state.probes).toBe(0)

    h.state.quitting = false
    h.watchdog.stop()
    await h.pump(5)
    expect(h.state.probes).toBe(0)
  })

  test("poke() runs an immediate probe cycle (powerMonitor wake)", async () => {
    const h = setup({ intervalMs: 600_000 })
    await h.pump(2)
    const before = h.state.probes
    h.state.healthy = false
    h.watchdog.poke()
    await sleep(6)
    h.watchdog.poke()
    await sleep(6)
    expect(h.state.probes).toBeGreaterThanOrEqual(before + 2)
    expect(h.state.restarts).toHaveLength(1)
    h.watchdog.stop()
  })
})
