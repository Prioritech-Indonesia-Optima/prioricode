/**
 * Automatic verification pass (F1): when a drain is about to finish after the
 * Session mutated files, run the repository's verification command once and
 * feed a failure back to the model as a durable steering prompt so it fixes
 * the problem instead of declaring completion. Successful or disabled passes
 * are silent.
 */
export * as SessionVerify from "./verify"

import path from "path"
import { Duration, Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ConfigVerify } from "../../config/verify"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { FSUtil } from "../../fs-util"
import { AppProcess } from "../../process"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { Prompt } from "../prompt"
import { SessionSchema } from "../schema"

const defaultShell = () =>
  process.platform === "win32"
    ? (process.env.COMSPEC ?? "cmd.exe")
    : (process.env.SHELL ?? process.env.PRIORICODE_SHELL ?? "/bin/sh")

const MAX_OUTPUT_TAIL = 6_000

const outputTail = (value: string) =>
  value.length <= MAX_OUTPUT_TAIL ? value : `... truncated ...\n${value.slice(-MAX_OUTPUT_TAIL)}`

const output = (result: { readonly stdout: Buffer; readonly stderr: Buffer; readonly output?: Buffer }) =>
  outputTail(
    (result.output ?? Buffer.concat([result.stdout, result.stderr])).toString("utf8").trim() || "(no output captured)",
  )

const FailureOutput = Schema.Struct({ ok: Schema.Literal(false), exit: Schema.Number, tail: Schema.String })
type FailureOutput = typeof FailureOutput.Type

const packageScripts = Effect.fn("SessionVerify.packageScripts")(function* (fs: FSUtil.Interface, directory: string) {
  const raw = yield* fs
    .readFileStringSafe(path.join(directory, "package.json"))
    .pipe(Effect.catch(() => Effect.succeed<string | undefined>(undefined)))
  if (raw === undefined) return {}
  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> }
    return Object.fromEntries(
      Object.entries(parsed.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
  } catch {
    return {}
  }
})

const detectCommand = Effect.fn("SessionVerify.detectCommand")(function* (fs: FSUtil.Interface, directory: string) {
  const scripts = yield* packageScripts(fs, directory)
  if (scripts.test === undefined) return undefined
  const managers = [
    ["bun.lockb", "bun run test"],
    ["bun.lock", "bun run test"],
    ["pnpm-lock.yaml", "pnpm test"],
    ["yarn.lock", "yarn test"],
  ] as const
  for (const [file, run] of managers) if (yield* fs.existsSafe(path.join(directory, file))) return run
  return "npm test"
})

export interface Verifier {
  /** Records that a settled local tool call mutated the workspace. */
  readonly recordMutation: (toolName: string) => void
  /**
   * Called when a drain would otherwise finish. Returns true when a failure
   * steering prompt was admitted, meaning the caller must continue draining.
   */
  readonly beforeFinish: () => Effect.Effect<boolean>
}

export const make = (deps: {
  readonly db: Database.Interface["db"]
  readonly events: EventV2.Interface
  readonly fs: FSUtil.Interface
  readonly process: AppProcess.Interface
  readonly directory: string
  readonly sessionID: SessionSchema.ID
  readonly config: ConfigVerify.Info | undefined
}): Effect.Effect<Verifier, never, never> =>
  Effect.gen(function* () {
    const { config } = deps
    if (config?.enabled === false)
      return {
        recordMutation: () => {},
        beforeFinish: (): Effect.Effect<boolean> => Effect.succeed(false),
      } satisfies Verifier
    let mutated = false
    let attempts = 0
    const limit = config?.max_attempts ?? 1
    let command: string | undefined = config?.command
    let resolved = command !== undefined
    const runCommand = Effect.fnUntraced(function* (cmd: string, directory: string, appProcess: AppProcess.Interface) {
      return yield* appProcess
        .run(
          ChildProcess.make(cmd, [], {
            cwd: directory,
            shell: defaultShell(),
            stdin: "ignore",
            detached: process.platform !== "win32",
            forceKillAfter: Duration.seconds(3),
          }),
          {
            combineOutput: true,
            timeout: Duration.millis(config?.timeout ?? 120_000),
            maxOutputBytes: 64_000,
          },
        )
        .pipe(Effect.catch(() => Effect.void))
    })

    return {
      recordMutation: (toolName) => {
        if (toolName === "edit" || toolName === "write" || toolName === "apply_patch") mutated = true
      },
      beforeFinish: () =>
        Effect.gen(function* () {
          if (!mutated || attempts >= limit) return false
          if (!resolved) {
            command = yield* detectCommand(deps.fs, deps.directory)
            resolved = true
            if (command === undefined) return false
          }
          attempts++
          const cmd = command
          if (cmd === undefined) return false
          const result = yield* runCommand(cmd, deps.directory, deps.process)
          if (result === undefined || result.exitCode === 0) return false
          const failure: FailureOutput = { ok: false, exit: result.exitCode, tail: output(result) }
          yield* SessionInput.admit(deps.db, deps.events, {
            id: SessionMessage.ID.create(),
            sessionID: deps.sessionID,
            prompt: Prompt.make({
              text: [
                `Automatic verification before completion failed: \`${command}\` exited ${failure.exit}.`,
                "Fix these failures before ending the task; do not claim completion while the verification command fails. If a fix is genuinely impossible, explain why in your final message.",
                "Output:",
                "```",
                failure.tail,
                "```",
              ].join("\n"),
            }),
            delivery: "steer",
          })
          return true
        }),
    }
  })
