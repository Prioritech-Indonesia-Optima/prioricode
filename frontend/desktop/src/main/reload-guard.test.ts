import { describe, expect, test } from "bun:test"
import { createReloadGuard } from "./reload-guard"

function setup(options?: { alive?: boolean }) {
  const clock = {
    time: 5_000,
    now() {
      return this.time
    },
    advance(ms: number) {
      this.time += ms
    },
  }
  const state = { alive: options?.alive ?? true, reloads: 0 }
  const guard = createReloadGuard({
    isAlive: () => state.alive,
    reload: () => {
      state.reloads += 1
    },
    now: () => clock.now(),
    cooldownMs: 10_000,
  })
  return { clock, state, guard }
}

describe("reload guard", () => {
  test("first crash reloads immediately", () => {
    const h = setup()
    expect(h.guard.tryReload()).toBe(true)
    expect(h.state.reloads).toBe(1)
  })

  test("rapid repeat crashes are gated by the cooldown (dialog fallback wins)", () => {
    const h = setup()
    expect(h.guard.tryReload()).toBe(true)
    h.clock.advance(3_000)
    expect(h.guard.tryReload()).toBe(false)
    h.clock.advance(6_000)
    expect(h.guard.tryReload()).toBe(false)
    h.clock.advance(1_001)
    expect(h.guard.tryReload()).toBe(true)
    expect(h.state.reloads).toBe(2)
  })

  test("a destroyed window never reloads", () => {
    const h = setup({ alive: false })
    expect(h.guard.tryReload()).toBe(false)
    expect(h.state.reloads).toBe(0)
  })
})
