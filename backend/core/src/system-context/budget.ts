/**
 * Context-budget tier: an always-rendered, quantized view of how full the
 * working context is, admitted as its own Context Source so the model learns
 * pressure chronologically (mid-conversation) instead of through silent
 * request rewriting. The value is one of four tiers that only change when a
 * 25% band boundary is crossed, keeping prompt-cache churn minimal; usage is
 * taken from billed prompt tokens of the previous provider turn.
 */
export * as SystemContextBudget from "./budget"

import { Effect, Schema } from "effect"
import { SystemContext } from "./index"

export type Tier = "low" | "moderate" | "high" | "critical"

export const key = SystemContext.Key.make("core/context-budget")

export const tierFor = (percent: number): Tier => {
  if (!Number.isFinite(percent) || percent < 25) return "low"
  if (percent < 50) return "moderate"
  if (percent < 75) return "high"
  return "critical"
}

const guidance: Record<Tier, string> = {
  low: "Context usage is low. No special economy is needed.",
  moderate:
    "Context usage is moderate. Prefer targeted file reads over whole-file dumps when you already know the region you need.",
  high: "Context usage is high. Consume output economically: read exact ranges instead of whole files, batch related operations, and expect automatic compaction soon.",
  critical:
    "Context usage is critical. Be maximally economical: minimal reads, no large pastes, finish the current verification loop before expanding scope.",
}

export const render = (tier: Tier) => `Context usage tier: ${tier}. ${guidance[tier]}`

export const context = (percent: number) => {
  const tier = tierFor(percent)
  // low contributes nothing so below-pressure requests stay byte-identical;
  // the notice appears once usage crosses into the moderate band and is
  // removed again when it drops back to low
  if (tier === "low") return SystemContext.empty
  return SystemContext.make({
    key,
    codec: Schema.toCodecJson(Schema.Literals(["low", "moderate", "high", "critical"])),
    load: Effect.succeed(tier),
    baseline: render,
    update: (_previous, current) => render(current),
    removed: () => "Context usage is no longer elevated; no special economy is needed.",
  })
}
