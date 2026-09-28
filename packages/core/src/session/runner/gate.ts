/**
 * Finish-gate pipeline: one decision point for everything that may refuse to
 * let a drain end (verification command, Stop hooks, goal evaluator, review).
 * Gates are consulted in priority order and the first one that continues wins,
 * so a single finish attempt admits at most one steering prompt. Each gate
 * owns its internal attempt budget; the pipeline owns the drain-wide round cap
 * that guarantees eventual completion — steer continuations reset per-turn
 * step counters, so no other bound would catch a livelocked gate.
 */
export * as SessionGate from "./gate"

import { Effect } from "effect"

export type Outcome = { readonly _tag: "Pass" } | { readonly _tag: "Continued" }

export const pass: Outcome = { _tag: "Pass" }
export const continued: Outcome = { _tag: "Continued" }

export interface Gate {
  readonly id: string
  /** Observe a settled local tool call. Synchronous and non-blocking by contract. */
  readonly observe: (name: string, ok: boolean) => void
  /**
   * Called only when the drain would otherwise finish. Returning `Continued`
   * requires having already admitted exactly one durable steering prompt.
   */
  readonly beforeFinish: () => Effect.Effect<Outcome>
}

export interface Pipeline {
  readonly observe: (name: string, ok: boolean) => void
  /** True means a gate continued the drain; false means the drain may finish. */
  readonly beforeFinish: () => Effect.Effect<boolean>
}

export const makePipeline = (deps: { readonly gates: readonly Gate[]; readonly maxRounds: number }): Pipeline => {
  let rounds = 0
  return {
    observe: (name, ok) => {
      for (const gate of deps.gates) gate.observe(name, ok)
    },
    beforeFinish: () =>
      Effect.gen(function* () {
        if (rounds >= deps.maxRounds) return false
        for (const gate of deps.gates) {
          const outcome = yield* gate.beforeFinish()
          if (outcome._tag === "Continued") {
            rounds += 1
            return true
          }
        }
        return false
      }),
  }
}

/** Neutral gate used when a feature's configuration is absent or disabled. */
export const disabled = (id: string): Gate => ({
  id,
  observe: () => {},
  beforeFinish: () => Effect.succeed(pass),
})
