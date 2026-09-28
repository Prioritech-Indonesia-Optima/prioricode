export * as ConfigLoop from "./loop"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Retry extends Schema.Class<Retry>("ConfigV2.Loop.Retry")({
  max_attempts: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum total provider attempts for one turn before the failure becomes visible",
  }),
  initial_delay: PositiveInt.pipe(Schema.optional).annotate({
    description: "Base delay in milliseconds for the first retry backoff step",
  }),
  max_delay: PositiveInt.pipe(Schema.optional).annotate({
    description: "Upper bound in milliseconds for any single retry delay, including retry-after hints",
  }),
  jitter: Schema.Finite.pipe(Schema.optional).annotate({
    description: "Random backoff jitter fraction between 0 and 1",
  }),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Loop")({
  tool_calls_per_turn: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum locally executed tool calls allowed within one provider turn",
  }),
  tool_output_bytes_per_turn: PositiveInt.pipe(Schema.optional).annotate({
    description: "Aggregate model-facing tool output budget in bytes before further calls are held back",
  }),
  repeat_warn: PositiveInt.pipe(Schema.optional).annotate({
    description: "Occurrence count at which an identical tool call receives a model-visible warning",
  }),
  repeat_block: PositiveInt.pipe(Schema.optional).annotate({
    description: "Occurrence count at which an identical tool call is blocked for the remainder of the drain",
  }),
  read_only_repeat_block: PositiveInt.pipe(Schema.optional).annotate({
    description: "Occurrence count at which an identical read-only tool call is blocked",
  }),
  read_only_tools: Schema.String.pipe(Schema.Array, Schema.optional).annotate({
    description: "Tool names treated as side-effect-free when counting identical repeated calls",
  }),
  gate_max_rounds: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum finish-gate continuations (verification, Stop hooks, goal) across one drain before the session is allowed to end",
  }),
  retry: Retry.pipe(Schema.optional),
}) {}
