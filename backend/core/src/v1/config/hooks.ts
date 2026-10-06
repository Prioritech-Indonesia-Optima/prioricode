export * as ConfigHooksV1 from "./hooks"

import { Schema } from "effect"
import { PositiveInt } from "../../schema"

export const HookCommand = Schema.Struct({
  matcher: Schema.optional(Schema.String).annotate({
    description:
      'Wildcard pattern over the tool name for PreToolUse/PostToolUse (e.g. "bash", "edit", "*"). Omitted matches all tools; ignored by lifecycle hooks',
  }),
  command: Schema.String.annotate({ description: "Shell command to run. Receives a JSON payload on stdin" }),
  timeout: Schema.optional(PositiveInt).annotate({ description: "Seconds before the hook is killed (default: 30)" }),
}).annotate({ identifier: "HookCommand" })
export type HookCommand = Schema.Schema.Type<typeof HookCommand>

export const Info = Schema.Struct({
  PreToolUse: Schema.optional(Schema.mutable(Schema.Array(HookCommand))).annotate({
    description: "Run before a tool executes. Exit code 2 blocks the call; stderr is fed back to the model",
  }),
  PostToolUse: Schema.optional(Schema.mutable(Schema.Array(HookCommand))).annotate({
    description: "Run after a tool completes. Observe-only (cannot undo the call)",
  }),
  SessionStart: Schema.optional(Schema.mutable(Schema.Array(HookCommand))).annotate({
    description: "Run when a new root session is created",
  }),
  Stop: Schema.optional(Schema.mutable(Schema.Array(HookCommand))).annotate({
    description: "Run when a root session goes idle (the assistant finished or was cancelled)",
  }),
  Notification: Schema.optional(Schema.mutable(Schema.Array(HookCommand))).annotate({
    description: "Run when the model needs a permission decision or a session errors",
  }),
}).annotate({ identifier: "HooksConfig" })
export type Info = Schema.Schema.Type<typeof Info>
