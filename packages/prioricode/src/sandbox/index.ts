export * as Sandbox from "."

import { Cause, Context, Duration, Effect, Layer, Schema } from "effect"
import os from "os"
import path from "path"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@prioricode/core/process"
import { FSUtil } from "@prioricode/core/fs-util"
import { Global } from "@prioricode/core/global"
import { Shell } from "@prioricode/core/shell"
import { makeGlobalNode } from "@prioricode/core/effect/app-node"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { SandboxEvent } from "@prioricode/schema/sandbox-event"

export type Mode = "off" | "best-effort" | "require"
export type Backend = "bwrap" | "seatbelt"

export class SandboxError extends Schema.TaggedErrorClass<SandboxError>()("SandboxError", {
  code: Schema.Literals(["require_unsupported", "wrap_failed"]),
  reason: Schema.String,
}) {
  override get message() {
    if (this.code === "require_unsupported") {
      return `Bash sandbox is required (bashSandbox.mode: "require") but unavailable: ${this.reason}. Install or enable the sandbox backend, or set bashSandbox.mode to "best-effort" or "off" in your prioricode config.`
    }
    return `Failed to build the bash sandbox: ${this.reason}`
  }
}

export type Capability =
  | { readonly supported: true; readonly backend: Backend }
  | { readonly supported: false; readonly reason: string }

export interface WrapInput {
  readonly original: ChildProcess.Command
  readonly shell: string
  readonly command: string
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

export interface WrapResult {
  readonly command: ChildProcess.Command
  readonly backend: Backend | "off"
  readonly warning?: string
}

export interface Interface {
  readonly probe: () => Effect.Effect<Capability, never, never>
  readonly wrap: (input: WrapInput) => Effect.Effect<WrapResult, SandboxError, never>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/Sandbox") {}

export interface BwrapInput {
  readonly command: string
  readonly shell: string
  readonly network: "allow" | "deny"
  readonly writable: string[]
}

export function bwrapArgs(input: BwrapInput): string[] {
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"]
  for (const dir of Array.from(new Set(input.writable))) {
    if (!dir || dir === "/") continue
    args.push("--bind", dir, dir)
  }
  args.push("--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts")
  if (input.network === "deny") args.push("--unshare-net")
  args.push("--die-with-parent", "--", input.shell, "-c", input.command)
  return args
}

export interface SeatbeltInput {
  readonly network: "allow" | "deny"
  readonly writable: string[]
}

export function seatbeltProfile(input: SeatbeltInput): string {
  const subpaths = Array.from(new Set(input.writable))
    .filter((dir) => dir && dir !== "/")
    .map((dir) => `(subpath "${dir.replace(/"/g, '\\"')}")`)
    .join(" ")
  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow file-read*)",
    subpaths ? `(allow file-write* ${subpaths})` : "(deny file-write*)",
    "(allow sysctl-read)",
    ...(input.network === "allow" ? ["(allow network*)"] : []),
    '(allow mach-lookup (global-name "com.apple.CoreFoundation.*") (global-name "com.apple.CFNetwork.*") (global-name "com.apple.Foundation.*") (global-name "com.apple.network.*") (global-name "com.apple.security.*") (global-name "com.apple.xpc.*") (global-name "com.apple.nscurl.*"))',
  ].join("\n")
}

export interface ProbeContext {
  readonly platform: NodeJS.Platform
  readonly exists: (file: string) => Effect.Effect<boolean>
  readonly run: (command: ChildProcess.Command) => Effect.Effect<{ exitCode: number; stderr: string }, unknown>
}

export const probeCapability = (ctx: ProbeContext) =>
  Effect.fn("Sandbox.probe")(function* () {
    if (ctx.platform === "win32") {
      return {
        supported: false as const,
        reason: "Windows has no OS sandbox backend in prioricode yet; commands run unsandboxed",
      }
    }
    if (ctx.platform === "darwin") {
      const has = yield* ctx.exists("/usr/bin/sandbox-exec")
      if (!has) return { supported: false as const, reason: "sandbox-exec was not found at /usr/bin/sandbox-exec" }
      return { supported: true as const, backend: "seatbelt" as const }
    }
    const result = yield* ctx
      .run(
        ChildProcess.make("bwrap", [
          "--ro-bind",
          "/",
          "/",
          "--dev",
          "/dev",
          "--proc",
          "/proc",
          "--unshare-user",
          "--unshare-pid",
          "--unshare-ipc",
          "--unshare-uts",
          "--die-with-parent",
          "true",
        ]),
      )
      .pipe(
        Effect.map((run) => ({ ok: run.exitCode === 0, detail: run.stderr.trim() })),
        Effect.catch((error) =>
          Effect.succeed({ ok: false as const, detail: error instanceof Error ? error.message : String(error) }),
        ),
      )
    if (result.ok) return { supported: true as const, backend: "bwrap" as const }
    return {
      supported: false as const,
      reason: `bwrap could not start a sandboxed process${result.detail ? `: ${result.detail}` : ""} (unprivileged user namespaces are often disabled in containers)`,
    }
  })

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const app = yield* AppProcess.Service
    const fs = yield* FSUtil.Service
    const events = yield* EventV2Bridge.Service
    const global = yield* Global.Service
    const probeEffect = yield* Effect.cached(
      probeCapability({
        platform: process.platform,
        exists: (file) => fs.existsSafe(file),
        run: (command) =>
          app
            .run(command, { timeout: Duration.seconds(2), maxOutputBytes: 8192 })
            .pipe(Effect.map((run) => ({ exitCode: run.exitCode, stderr: run.stderr.toString("utf8") }))),
      })(),
    )

    const state = yield* InstanceState.make(
      Effect.fn("Sandbox.state")(function* (ctx: { directory: string; worktree: string; project: { vcs?: string } }) {
        const vcsStore = yield* Effect.cached(
          Effect.fnUntraced(function* () {
            if (ctx.project.vcs !== "git") return undefined
            const out = yield* app
              .run(
                ChildProcess.make("git", ["rev-parse", "--git-common-dir"], {
                  cwd: ctx.directory,
                  extendEnv: true,
                  stdin: "ignore",
                }),
                { timeout: Duration.seconds(2), maxOutputBytes: 4096 },
              )
              .pipe(
                Effect.map((run) => run.stdout.toString("utf8").trim()),
                Effect.catch(() => Effect.succeed("")),
              )
            if (!out) return undefined
            return path.isAbsolute(out) ? out : path.resolve(ctx.directory, out)
          })(),
        )
        let announced: string | undefined
        const announce = (reason: string, mode: "best-effort" | "require") =>
          Effect.gen(function* () {
            if (announced !== undefined) return
            announced = reason
            yield* Effect.logWarning("bash sandbox requested but unavailable", { reason, mode })
            yield* events.publish(SandboxEvent.Unavailable, { reason, mode }).pipe(
              Effect.catchCause((cause) =>
                Effect.logError("failed to publish sandbox.unavailable event", {
                  cause: String(Cause.squash(cause)),
                }),
              ),
            )
          })
        return { vcsStore, announce }
      }),
    )

    const wrap = Effect.fn("Sandbox.wrap")(function* (input: WrapInput) {
      const cfg = yield* config.get()
      const mode = cfg.bashSandbox?.mode ?? "off"
      if (mode === "off") return { command: input.original, backend: "off" as const }

      const instance = yield* InstanceState.get(state)
      if (Shell.ps(input.shell)) {
        const reason = `the configured shell (${Shell.name(input.shell)}) is not sandboxed`
        if (mode === "require") return yield* new SandboxError({ code: "require_unsupported", reason })
        yield* instance.announce(reason, mode)
        return { command: input.original, backend: "off" as const, warning: reason }
      }

      const cap = yield* probeEffect
      if (!cap.supported) {
        if (mode === "require") return yield* new SandboxError({ code: "require_unsupported", reason: cap.reason })
        yield* instance.announce(cap.reason, mode)
        return { command: input.original, backend: "off" as const, warning: cap.reason }
      }

      const ctx = yield* InstanceState.context
      const cacheCandidates = [path.join(global.home, ".npm"), path.join(global.home, ".bun", "install", "cache")]
      const existingCaches = yield* Effect.forEach(cacheCandidates, (dir) =>
        fs.existsSafe(dir).pipe(Effect.map((has) => (has ? dir : undefined))),
      )
      const writable = [
        ctx.directory,
        ctx.worktree !== "/" ? ctx.worktree : undefined,
        yield* instance.vcsStore,
        global.data,
        os.tmpdir(),
        ...existingCaches,
        ...(cfg.bashSandbox?.writablePaths ?? []),
      ].filter((item): item is string => Boolean(item))
      const network = cfg.bashSandbox?.network ?? "allow"

      return yield* Effect.try({
        try: () => {
          if (cap.backend === "bwrap") {
            return {
              command: ChildProcess.make(
                "bwrap",
                bwrapArgs({ command: input.command, shell: input.shell, network, writable }),
                { cwd: input.cwd, env: input.env, stdin: "ignore", detached: true },
              ),
              backend: "bwrap" as const,
            }
          }
          return {
            command: ChildProcess.make(
              "sandbox-exec",
              ["-p", seatbeltProfile({ network, writable }), input.shell, "-c", input.command],
              { cwd: input.cwd, env: input.env, stdin: "ignore", detached: true },
            ),
            backend: "seatbelt" as const,
          }
        },
        catch: (cause) =>
          new SandboxError({ code: "wrap_failed", reason: cause instanceof Error ? cause.message : String(cause) }),
      })
    })

    return Service.of({
      probe: () => probeEffect,
      wrap,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [Config.node, AppProcess.node, FSUtil.node, EventV2Bridge.node, Global.node],
})
