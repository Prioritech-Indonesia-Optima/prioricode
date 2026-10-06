export * as SandboxEvent from "./sandbox-event"

import { Schema } from "effect"
import { Event } from "./event"

export const Unavailable = Event.define({
  type: "sandbox.unavailable",
  schema: {
    reason: Schema.String,
    mode: Schema.Literals(["best-effort", "require"]),
  },
})

export const Definitions = Event.inventory(Unavailable)
