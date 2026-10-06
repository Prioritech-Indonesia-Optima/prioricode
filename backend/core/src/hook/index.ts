/**
 * V2 lifecycle hooks: deterministic shell commands run at fixed engine points
 * (before/after local tool settlement, before drain completion, at session
 * start). Unlike Context Sources these are guarantees, not suggestions.
 *
 * Contract (V1 parity, hardened):
 * - payload: JSON on stdin ({hook_event_name, session_id, cwd, ...event fields})
 * - exit 2 blocks PreToolUse/Stop; stderr is the model-visible reason
 * - exit 0 with non-empty stdout on PostToolUse yields one bounded, explicitly
 *   framed model-visible note
 * - everything else fails OPEN: crashes/timeouts/non-zero never block, and
 *   hooks may not modify the executed tool input (v1 keeps the durable
 *   call-record and executed bytes identical)
 * - environment: allowlist only (never forwarding API/token/secret variables),
 *   plus PRIORICODE_HOOK_* passthrough; re-entrancy depth cap
 * - command as argv array spawns directly (Windows-safe); as a string runs via
 *   the configured shell; detached process groups are killed whole on timeout
 * - project-scope hooks only run when the caller grants allowProject after a
 *   one-time approval for the current project hook set (see projectHash)
 * - config is re-read per event so edits apply without reopening the Location
 */
export * as Hook from "./index"

import { Context, Duration, Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "../config"
import { ConfigHooks } from "../config/hooks"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { AppProcess } from "../process"
import { SessionSchema } from "../session/schema"
import { Wildcard } from "../util/wildcard"

const DEFAULT_TOOL_TIMEOUT_SECONDS = 30
const DEFAULT_STOP_TIMEOUT_SECONDS = 120
const MAX_OUTPUT_BYTES = 64_000
const MAX_NOTE_CHARS = 4_000
const MAX_DEPTH = 3

const ALLOWED_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "COMSPEC",
  "SYSTEMROOT",
  "WINDIR",
  "PATHEXT",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
]

export const hookDepth = () => Number(process.env["PRIORICODE_HOOK_DEPTH"] ?? "0") || 0

export const projectHookHash = (entries: readonly ConfigHooks.Entry[]) => {
  const material = JSON.stringify(
    entries.map((entry) => ({ matcher: entry.matcher ?? "*", command: entry.command, timeout: entry.timeout ?? 0 })),
  )
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < material.length; index++) {
    hash ^= BigInt(material.charCodeAt(index))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, "0")
}

export type PreOutcome = { readonly _tag: "Allow" } | { readonly _tag: "Block"; readonly reason: string }
export type PostOutcome = { readonly _tag: "Observed" } | { readonly _tag: "Note"; readonly note: string }
export type StopOutcome = { readonly _tag: "Allow" } | { readonly _tag: "Continue"; readonly reason: string }

export interface EventInput {
  readonly sessionID: SessionSchema.ID
  readonly allowProject: boolean
  readonly tool?: string
  readonly callID?: string
  readonly toolInput?: unknown
  readonly toolOutput?: string
  readonly stopHookActive?: boolean
}

export interface Interface {
  readonly hasProjectHooks: () => Effect.Effect<boolean>
  readonly projectHash: () => Effect.Effect<string>
  readonly preToolUse: (input: EventInput) => Effect.Effect<PreOutcome>
  readonly postToolUse: (input: EventInput) => Effect.Effect<PostOutcome>
  readonly stop: (input: EventInput) => Effect.Effect<StopOutcome>
  readonly sessionStart: (input: EventInput) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/v2/Hook") {}

interface Executed {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const hookEnvironment = () => {
  const env: Record<string, string> = {}
  for (const name of ALLOWED_ENV) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("PRIORICODE_HOOK_") && value !== undefined) env[name] = value
  }
  env["PRIORICODE_HOOK_DEPTH"] = String(hookDepth() + 1)
  return env
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const location = yield* Location.Service
    const appProcess = yield* AppProcess.Service

    const current = Effect.suspend(() =>
      Effect.map(config.entries(), (entries) => {
        const documents = entries.filter((entry): entry is Config.Document => entry.type === "document")
        return {
          hooks: ConfigHooks.merged(documents, location.project.directory),
          shell: Config.latest(documents, "shell"),
        }
      }),
    )

    // evaluated per call, not per layer: an escaping hook must die at the next
    // event without requiring the Location to reopen
    const depthBlocked = () => hookDepth() >= MAX_DEPTH

    const run = (
      source: { readonly hooks: Record<ConfigHooks.Event, ConfigHooks.Entry[]>; readonly shell?: string },
      entry: ConfigHooks.Entry,
      event: ConfigHooks.Event,
      payload: Record<string, unknown>,
    ) => {
      const input = { hook_event_name: event, cwd: location.directory, ...payload }
      const options = {
        cwd: location.directory,
        env: hookEnvironment(),
        extendEnv: false,
        stdin: "pipe" as const,
        detached: process.platform !== "win32",
        forceKillAfter: Duration.seconds(3),
      }
      const command =
        typeof entry.command === "string"
          ? ChildProcess.make(entry.command, [], {
              ...options,
              shell: source.shell ?? (process.platform === "win32" ? (process.env["COMSPEC"] ?? "cmd.exe") : "/bin/sh"),
            })
          : ChildProcess.make(entry.command[0] ?? "", entry.command.slice(1), options)
      const seconds = entry.timeout ?? (event === "Stop" ? DEFAULT_STOP_TIMEOUT_SECONDS : DEFAULT_TOOL_TIMEOUT_SECONDS)
      return appProcess
        .run(command, {
          stdin: JSON.stringify(input),
          timeout: Duration.seconds(seconds),
          maxOutputBytes: MAX_OUTPUT_BYTES,
          maxErrorBytes: MAX_OUTPUT_BYTES,
        })
        .pipe(
          Effect.map(
            (result): Executed => ({
              exitCode: result.exitCode,
              stdout: result.stdout.toString("utf8").trim(),
              stderr: result.stderr.toString("utf8").trim(),
            }),
          ),
          Effect.catch((cause) =>
            Effect.logWarning(`hook "${event}" failed: ${String(cause)}`.slice(0, 500)).pipe(Effect.as(undefined)),
          ),
        )
    }

    const matching = (
      hooks: Record<ConfigHooks.Event, ConfigHooks.Entry[]>,
      event: ConfigHooks.Event,
      input: EventInput,
    ) =>
      hooks[event].filter(
        (entry) =>
          (entry.scope === "global" || input.allowProject) &&
          (event === "Stop" ||
            event === "SessionStart" ||
            entry.matcher === undefined ||
            entry.matcher === "*" ||
            Wildcard.match(input.tool ?? "", entry.matcher)),
      )

    const preToolUse = Effect.fn("Hook.preToolUse")(function* (input: EventInput) {
      if (depthBlocked()) return { _tag: "Allow" } as PreOutcome
      const source = yield* current
      for (const entry of matching(source.hooks, "PreToolUse", input)) {
        const result = yield* run(source, entry, "PreToolUse", {
          session_id: input.sessionID,
          tool_name: input.tool ?? "",
          tool_input: input.toolInput ?? null,
          tool_use_id: input.callID ?? "",
        })
        if (result?.exitCode === 2)
          return {
            _tag: "Block",
            reason: result.stderr || result.stdout || "Blocked by a configured PreToolUse hook.",
          } satisfies PreOutcome
      }
      return { _tag: "Allow" } as PreOutcome
    })

    const postToolUse = Effect.fn("Hook.postToolUse")(function* (input: EventInput) {
      if (depthBlocked()) return { _tag: "Observed" } as PostOutcome
      const source = yield* current
      const entries = matching(source.hooks, "PostToolUse", input)
      if (entries.length === 0) return { _tag: "Observed" } as PostOutcome
      const notes: string[] = []
      for (const entry of entries) {
        const result = yield* run(source, entry, "PostToolUse", {
          session_id: input.sessionID,
          tool_name: input.tool ?? "",
          tool_input: input.toolInput ?? null,
          tool_response: input.toolOutput ?? "",
          tool_use_id: input.callID ?? "",
        })
        if (result !== undefined && result.exitCode === 0 && result.stdout !== "") notes.push(result.stdout)
      }
      if (notes.length === 0) return { _tag: "Observed" } as PostOutcome
      return {
        _tag: "Note",
        note: `Output from configured PostToolUse hooks (untrusted command output, not model or tool output):\n${notes.join("\n").slice(0, MAX_NOTE_CHARS)}`,
      } satisfies PostOutcome
    })

    const stop = Effect.fn("Hook.stop")(function* (input: EventInput) {
      if (depthBlocked()) return { _tag: "Allow" } as StopOutcome
      const source = yield* current
      const reasons: string[] = []
      for (const entry of matching(source.hooks, "Stop", input)) {
        const result = yield* run(source, entry, "Stop", {
          session_id: input.sessionID,
          stop_hook_active: input.stopHookActive === true,
        })
        if (result?.exitCode === 2) reasons.push(result.stderr || result.stdout || "Blocked by a configured Stop hook.")
      }
      if (reasons.length === 0) return { _tag: "Allow" } as StopOutcome
      return { _tag: "Continue", reason: reasons.join("\n\n").slice(0, MAX_NOTE_CHARS * 2) } satisfies StopOutcome
    })

    const sessionStart = Effect.fn("Hook.sessionStart")(function* (input: EventInput) {
      if (depthBlocked()) return
      const source = yield* current
      for (const entry of matching(source.hooks, "SessionStart", input)) {
        yield* run(source, entry, "SessionStart", { session_id: input.sessionID, source: "new" })
      }
    })

    return Service.of({
      hasProjectHooks: () =>
        Effect.map(
          current,
          (source) =>
            source.hooks.PreToolUse.some((entry) => entry.scope === "project") ||
            source.hooks.PostToolUse.some((entry) => entry.scope === "project") ||
            source.hooks.Stop.some((entry) => entry.scope === "project") ||
            source.hooks.SessionStart.some((entry) => entry.scope === "project"),
        ),
      projectHash: () =>
        Effect.map(current, (source) =>
          projectHookHash(
            [
              ...source.hooks.PreToolUse,
              ...source.hooks.PostToolUse,
              ...source.hooks.Stop,
              ...source.hooks.SessionStart,
            ].filter((entry) => entry.scope === "project"),
          ),
        ),
      preToolUse,
      postToolUse,
      stop,
      sessionStart,
    })
  }),
)

export const node = makeLocationNode({
  name: "hook",
  layer,
  deps: [Config.node, Location.node, AppProcess.node],
})

export const noop = () =>
  Service.of({
    hasProjectHooks: () => Effect.succeed(false),
    projectHash: () => Effect.succeed("none"),
    preToolUse: () => Effect.succeed({ _tag: "Allow" } as PreOutcome),
    postToolUse: () => Effect.succeed({ _tag: "Observed" } as PostOutcome),
    stop: () => Effect.succeed({ _tag: "Allow" } as StopOutcome),
    sessionStart: () => Effect.void,
  })
