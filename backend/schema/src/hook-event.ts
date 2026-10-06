export * as HookEvent from "./hook-event"

import { Schema } from "effect"
import { Event } from "./event"

export const HookNames = Schema.Literals(["PreToolUse", "PostToolUse", "SessionStart", "Stop", "Notification"])
export type HookName = typeof HookNames.Type

export const Failed = Event.define({
  type: "hook.failed",
  schema: {
    event: HookNames,
    command: Schema.String,
    reason: Schema.String,
  },
})

export const Definitions = Event.inventory(Failed)
