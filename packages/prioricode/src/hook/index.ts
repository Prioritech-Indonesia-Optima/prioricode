export * as Hook from "."

import { Context, Effect, Exit, Layer, Schema, Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@prioricode/core/process"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Shell } from "@prioricode/core/shell"
import { Wildcard } from "@prioricode/core/util/wildcard"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { HookEvent } from "@prioricode/schema/hook-event"
import type { ConfigHooksV1 } from "@prioricode/core/v1/config/hooks"
import type { SessionID } from "@/session/schema"

export type HookName = HookEvent.HookName

const MAX_OUTPUT_BYTES = 65_536
const DEFAULT_TIMEOUT_SECONDS = 30
const ENV_ALLOW = /^(PATH|HOME|SHELL|TERM|LANG|LC_|TMPDIR|TEMP|TMP|USER|XDG_)/
const SECRETISH = /(API_KEY|TOKEN|SECRET|PASSWORD)/i

export class BlockedError extends Schema.TaggedErrorClass<BlockedError>()("Hook.BlockedError", {
  tool: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Tool call blocked by a PreToolUse hook: ${this.reason}`
  }
}

export interface PreToolUseInput {
  readonly tool: string
  readonly sessionID: SessionID
  readonly callID: string | undefined
  readonly args: unknown
}

export interface PostToolUseInput extends PreToolUseInput {
  readonly response: { title: string; output: string; metadata: unknown }
}

export interface Interface {
  readonly init: () => Effect.Effect<void, never>
  readonly preToolUse: (input: PreToolUseInput) => Effect.Effect<string | undefined, never>
  readonly postToolUse: (input: PostToolUseInput) => Effect.Effect<void, never>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/Hook") {}

const guarded = () => Number(process.env.PRIORICODE_HOOK_DEPTH ?? "0") >= 1

export function hookMatches(matcher: string | undefined, tool: string) {
  if (!matcher || matcher === "*") return true
  return Wildcard.match(tool, matcher)
}

export function hookEnv(sessionID: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PRIORICODE_HOOK_DEPTH: "1",
    PRIORICODE_SESSION_ID: sessionID,
  }
  for (const key of Object.keys(process.env)) {
    if (!ENV_ALLOW.test(key)) continue
    if (SECRETISH.test(key)) continue
    env[key] = process.env[key]
  }
  return env
}

export function hookCommand(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32") {
    if (Shell.ps(shell))
      return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
        cwd,
        env,
        extendEnv: false,
        stdin: "ignore",
      })
    return ChildProcess.make(shell, ["/d", "/c", command], { cwd, env, extendEnv: false, stdin: "ignore" })
  }
  return ChildProcess.make(shell, ["-lc", command], { cwd, env, extendEnv: false, stdin: "ignore" })
}

type HookCommand = ConfigHooksV1.HookCommand

interface RunResult {
  readonly ran: boolean
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: string
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const app = yield* AppProcess.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* Session.Service
    const scope = yield* Scope.Scope

    const runOne = Effect.fn("Hook.runOne")(function* (
      name: HookName,
      hook: HookCommand,
      shell: string,
      directory: string,
      sessionID: string,
      payload: Record<string, unknown>,
    ) {
      const result = yield* app
        .run(hookCommand(shell, hook.command, directory, hookEnv(sessionID)), {
          stdin: JSON.stringify({ hook_event_name: name, session_id: sessionID, cwd: directory, ...payload }),
          timeout: `${hook.timeout ?? DEFAULT_TIMEOUT_SECONDS} seconds`,
          maxOutputBytes: MAX_OUTPUT_BYTES,
          maxErrorBytes: MAX_OUTPUT_BYTES,
        })
        .pipe(
          Effect.map(
            (run) =>
              ({
                ran: true,
                exitCode: run.exitCode,
                stdout: run.stdout.toString("utf8").trim(),
                stderr: run.stderr.toString("utf8").trim(),
              }) satisfies RunResult,
          ),
          Effect.catch((error) =>
            Effect.succeed({
              ran: false,
              exitCode: null,
              stdout: "",
              stderr: "",
              error: error.message,
            } satisfies RunResult),
          ),
        )
      const failed = !result.ran
        ? `hook process could not start: ${result.error ?? "unknown error"}`
        : result.exitCode === 2 && name !== "PreToolUse"
          ? `hook exited 2 (ignored for ${name}; only PreToolUse can block): ${result.stderr || hook.command}`
          : result.exitCode !== 0
            ? `hook exited ${result.exitCode ?? "null"}: ${result.stderr || hook.command}`
            : undefined
      if (failed !== undefined) {
        yield* Effect.logWarning("shell hook failed", { event: name, command: hook.command, reason: failed })
        yield* events.publish(HookEvent.Failed, { event: name, command: hook.command, reason: failed }).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("failed to publish hook.failed event", {
              cause: cause instanceof Error ? cause.message : String(cause),
            }),
          ),
        )
      }
      return result
    })

    const fireSync = Effect.fn("Hook.fireSync")(function* (
      name: HookName,
      directory: string,
      sessionID: string,
      tool: string | undefined,
      payload: Record<string, unknown>,
    ) {
      const cfg = yield* config.get()
      const hooks = cfg.hooks?.[name] ?? []
      const shell = Shell.acceptable(cfg.shell)
      let block: string | undefined
      for (const hook of hooks) {
        if ((name === "PreToolUse" || name === "PostToolUse") && tool && !hookMatches(hook.matcher, tool)) continue
        const result = yield* runOne(name, hook, shell, directory, sessionID, payload)
        if (name === "PreToolUse" && result.ran && result.exitCode === 2) {
          block = [block, result.stderr || `hook blocked the call: ${hook.command}`].filter(Boolean).join("\n")
        }
      }
      return block
    })

    const fireForked = (name: HookName, directory: string, sessionID: string, payload: Record<string, unknown>) =>
      Effect.gen(function* () {
        if (guarded()) return
        const cfg = yield* config.get()
        if ((cfg.hooks?.[name] ?? []).length === 0) return
        yield* fireSync(name, directory, sessionID, undefined, payload).pipe(Effect.forkIn(scope))
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("shell hook dispatch failed", {
            event: name,
            cause: cause instanceof Error ? cause.message : String(cause),
          }),
        ),
      )

    const state = yield* InstanceState.make(
      Effect.fn("Hook.state")(function* (ctx: { directory: string }) {
        const unsubscribe = yield* events.listen((event) => {
          if (guarded()) return Effect.void
          if (event.location?.directory !== ctx.directory) return Effect.void
          return Effect.gen(function* () {
            if (event.type === "session.created") {
              const data = event.data as { info?: { parentID?: unknown } }
              if (data.info?.parentID) return
              const sid = (event.data as { sessionID?: string }).sessionID ?? ""
              yield* fireForked("SessionStart", ctx.directory, sid, { source: "startup" })
            }
            if (event.type === "session.idle") {
              const data = event.data as { sessionID?: SessionID }
              if (!data.sessionID) return
              const info = yield* Effect.exit(session.get(data.sessionID))
              if (Exit.isFailure(info)) {
                yield* Effect.logWarning("cannot resolve session for Stop hook; skipping", {
                  sessionID: data.sessionID,
                })
                return
              }
              if (info.value.parentID) return
              yield* fireForked("Stop", ctx.directory, data.sessionID, {})
            }
            if (event.type === "permission.asked") {
              const data = event.data as { sessionID?: SessionID; permission?: string; patterns?: string[] }
              yield* fireForked("Notification", ctx.directory, data.sessionID ?? "", {
                message: `prioricode is requesting permission for ${data.permission ?? "a tool"}: ${(data.patterns ?? []).join(", ")}`,
                notification_type: "permission",
              })
            }
            if (event.type === "session.error") {
              const data = event.data as {
                sessionID?: SessionID
                error?: { name?: string; data?: { message?: string } }
              }
              const message = data.error?.data?.message ?? data.error?.name ?? "session error"
              yield* fireForked("Notification", ctx.directory, data.sessionID ?? "", {
                message: `prioricode session encountered an error: ${message}`,
                notification_type: "error",
              })
            }
          }).pipe(
            Effect.catchCause((cause) => Effect.logError("hook event dispatch crashed", { cause: String(cause) })),
          )
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        return {}
      }),
    )

    const preToolUse = Effect.fn("Hook.preToolUse")(function* (input: PreToolUseInput) {
      if (guarded()) return undefined
      const instance = yield* InstanceState.context
      yield* InstanceState.get(state)
      return yield* fireSync("PreToolUse", instance.directory, input.sessionID, input.tool, {
        tool_name: input.tool,
        tool_input: input.args,
      })
    })

    const postToolUse = Effect.fn("Hook.postToolUse")(function* (input: PostToolUseInput) {
      if (guarded()) return
      const cfg = yield* config.get()
      const any = (cfg.hooks?.PostToolUse ?? []).some((hook) => hookMatches(hook.matcher, input.tool))
      if (!any) return
      const instance = yield* InstanceState.context
      yield* InstanceState.get(state)
      yield* fireSync("PostToolUse", instance.directory, input.sessionID, input.tool, {
        tool_name: input.tool,
        tool_input: input.args,
        tool_response: input.response,
      }).pipe(Effect.forkIn(scope))
    })

    const init = Effect.fn("Hook.init")(function* () {
      yield* InstanceState.get(state)
    })

    return Service.of({ init, preToolUse, postToolUse })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, AppProcess.node, EventV2Bridge.node, Session.node],
})
