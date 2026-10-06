export * as ConfigVerify from "./verify"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigV2.Verify")({
  command: Schema.String.pipe(Schema.optional).annotate({
    description:
      "Shell command that must pass before the agent may finish after mutating files (for example 'bun test'). When omitted, verification auto-detects a test script from the active Location package.json",
  }),
  enabled: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Disable the automatic verification pass entirely (default: enabled)",
  }),
  timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Verification command timeout in milliseconds (default: 120000)",
  }),
  max_attempts: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum verification failure continuations injected per drain (default: 1)",
  }),
}) {}
