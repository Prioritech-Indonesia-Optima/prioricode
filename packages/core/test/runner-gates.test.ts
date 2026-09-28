import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SessionGate } from "@prioricode/core/session/runner/gate"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const gate = (id: string, continueTimes: number, log: string[]) => {
  let left = continueTimes
  return {
    id,
    observe: () => {},
    beforeFinish: () =>
      Effect.sync(() => {
        if (left > 0) {
          left -= 1
          log.push(id)
          return SessionGate.continued
        }
        return SessionGate.pass
      }),
  } satisfies SessionGate.Gate
}

describe("SessionGate pipeline", () => {
  it.effect("short-circuits on the first continuing gate so one boundary admits one prompt", () =>
    Effect.gen(function* () {
      const log: string[] = []
      const pipeline = SessionGate.makePipeline({
        gates: [gate("stop", 1, log), gate("verify", 5, log), gate("goal", 5, log)],
        maxRounds: 10,
      })
      expect(yield* pipeline.beforeFinish()).toBe(true)
      expect(log).toEqual(["stop"])
      expect(yield* pipeline.beforeFinish()).toBe(true)
      expect(yield* pipeline.beforeFinish()).toBe(true)
      expect(log).toEqual(["stop", "verify", "verify"])
    }),
  )

  it.effect("drain-wide cap forces finish even with eternally continuing gates", () =>
    Effect.gen(function* () {
      const log: string[] = []
      const pipeline = SessionGate.makePipeline({
        gates: [gate("verify", 100, log)],
        maxRounds: 3,
      })
      expect(yield* pipeline.beforeFinish()).toBe(true)
      expect(yield* pipeline.beforeFinish()).toBe(true)
      expect(yield* pipeline.beforeFinish()).toBe(true)
      expect(yield* pipeline.beforeFinish()).toBe(false)
      expect(log).toHaveLength(3)
    }),
  )

  it.effect("no gates or all-pass finishes immediately", () =>
    Effect.gen(function* () {
      expect(yield* SessionGate.makePipeline({ gates: [], maxRounds: 6 }).beforeFinish()).toBe(false)
      const log: string[] = []
      const pipeline = SessionGate.makePipeline({ gates: [gate("a", 0, log), gate("b", 0, log)], maxRounds: 6 })
      expect(yield* pipeline.beforeFinish()).toBe(false)
      expect(log).toEqual([])
    }),
  )

  it.effect("observe fans out to every gate", () => {
    const seen: Array<[string, boolean]> = []
    const recording = (id: string): SessionGate.Gate => ({
      id,
      observe: (name, ok) => seen.push([name, ok]),
      beforeFinish: () => Effect.succeed(SessionGate.pass),
    })
    const pipeline = SessionGate.makePipeline({ gates: [recording("a"), recording("b")], maxRounds: 1 })
    pipeline.observe("edit", true)
    expect(seen).toEqual([
      ["edit", true],
      ["edit", true],
    ])
    return Effect.void
  })
})
