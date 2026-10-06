export * as ConfigPrune from "./prune"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

/**
 * Pressure-gated projection of old large tool results out of provider
 * requests only; durable history and replay keep the full bytes.
 */
export class Info extends Schema.Class<Info>("ConfigV2.Prune")({
  pressure_percent: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
    .pipe(Schema.optional)
    .annotate({
      description: "Percent of the model context window at which stale tool output starts being elided (default 70)",
    }),
  keep_recent_steps: PositiveInt.pipe(Schema.optional).annotate({
    description: "Trailing assistant steps whose tool output is never elided (default 15)",
  }),
  min_bytes: PositiveInt.pipe(Schema.optional).annotate({
    description: "Tool results below this serialized size are never elided (default 8000)",
  }),
}) {}
