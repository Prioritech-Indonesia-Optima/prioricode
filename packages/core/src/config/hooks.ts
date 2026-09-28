export * as ConfigHooks from "./hooks"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

/**
 * A shell hook command. `command` as a string runs through the configured
 * shell; as an array it is spawned directly (argv[0] = program) which is the
 * portable path on Windows. The hook receives its event payload as JSON on
 * stdin. Exit code 2 signals a block for PreToolUse/Stop (stderr becomes the
 * model-visible reason); exit code 0 allows. PostToolUse stdout may carry a
 * bounded model-visible note.
 */
export class HookCommand extends Schema.Class<HookCommand>("ConfigV2.Hooks.Command")({
  matcher: Schema.String.pipe(Schema.optional).annotate({
    description: "Wildcard over tool names (PreToolUse/PostToolUse); omitted or '*' matches all. Ignored by Stop/SessionStart",
  }),
  command: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Seconds before the hook is killed and treated as non-blocking (defaults: 30s tool hooks, 120s Stop)",
  }),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Hooks")({
  PreToolUse: Schema.Array(HookCommand).pipe(Schema.optional),
  PostToolUse: Schema.Array(HookCommand).pipe(Schema.optional),
  Stop: Schema.Array(HookCommand).pipe(Schema.optional),
  SessionStart: Schema.Array(HookCommand).pipe(Schema.optional),
}) {}

export type Event = "PreToolUse" | "PostToolUse" | "Stop" | "SessionStart"

export interface Entry extends HookCommand {
  readonly scope: "global" | "project"
}

/**
 * Ordered hook lists concatenate across config files (global first, project
 * last) instead of last-document-wins: a repository may add gates, it may
 * never silently delete the user's own. Mirrors permission-ruleset semantics.
 */
export const merged = (
  documents: ReadonlyArray<{ readonly path?: string; readonly info: { readonly hooks?: Info } }>,
  projectDirectory: string,
): Record<Event, Entry[]> => {
  const result: Record<Event, Entry[]> = { PreToolUse: [], PostToolUse: [], Stop: [], SessionStart: [] }
  for (const document of documents) {
    const hooks = document.info.hooks
    if (hooks === undefined) continue
    const scope: Entry["scope"] =
      document.path !== undefined && document.path.startsWith(projectDirectory) ? "project" : "global"
    for (const [event, commands] of [
      ["PreToolUse", hooks.PreToolUse] as const,
      ["PostToolUse", hooks.PostToolUse] as const,
      ["Stop", hooks.Stop] as const,
      ["SessionStart", hooks.SessionStart] as const,
    ])
      for (const command of commands ?? [])
        result[event].push({ matcher: command.matcher, command: command.command, timeout: command.timeout, scope })
  }
  return result
}

export const has = (hooks: Record<Event, Entry[]>) =>
  hooks.PreToolUse.length + hooks.PostToolUse.length + hooks.Stop.length + hooks.SessionStart.length > 0
