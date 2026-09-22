import { LayerNode } from "@prioricode/core/effect/layer-node"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { filesystem, httpClient } from "@prioricode/core/effect/app-node-platform"
import { Effect, FileSystem, Layer, Schema, Context, Stream } from "effect"
import { serviceUse } from "@prioricode/core/effect/service-use"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { errorMessage } from "@/util/error"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@prioricode/core/process"
import path from "path"
import os from "os"
import { makeRuntime } from "@prioricode/core/effect/runtime"
import semver from "semver"
import { InstallationChannel, InstallationVersion } from "@prioricode/core/installation/version"
import { NpmConfig } from "@prioricode/core/npm-config"
import { InstallationEvent } from "@prioricode/schema/installation-event"

export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

export type ReleaseType = "patch" | "minor" | "major"

export const Event = InstallationEvent

export function getReleaseType(current: string, latest: string): ReleaseType {
  const currMajor = semver.major(current)
  const currMinor = semver.minor(current)
  const newMajor = semver.major(latest)
  const newMinor = semver.minor(latest)

  if (newMajor > currMajor) return "major"
  if (newMinor > currMinor) return "minor"
  return "patch"
}

export const Info = Schema.Struct({
  version: Schema.String,
  latest: Schema.String,
}).annotate({ identifier: "InstallationInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export function userAgent(client = "cli") {
  return `prioricode/${InstallationChannel}/${InstallationVersion}/${client}`
}

export const USER_AGENT = userAgent()

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {
  override get message() {
    return this.stderr
  }
}

// Response schemas for external version APIs
const GitHubRelease = Schema.Struct({ tag_name: Schema.String })
const NpmPackage = Schema.Struct({ version: Schema.String })
const BrewFormula = Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })
const BrewInfoV2 = Schema.Struct({
  formulae: Schema.Array(Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })),
})
const ChocoPackage = Schema.Struct({
  d: Schema.Struct({ results: Schema.Array(Schema.Struct({ Version: Schema.String })) }),
})
const ScoopManifest = NpmPackage

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/Installation") {}

export const use = serviceUse(Service)

const layer: Layer.Layer<Service, never, HttpClient.HttpClient | AppProcess.Service | FileSystem.FileSystem> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))
      const appProcess = yield* AppProcess.Service
      const fs = yield* FileSystem.FileSystem

      const text = Effect.fnUntraced(
        function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
          const result = yield* appProcess.run(
            ChildProcess.make(cmd[0], cmd.slice(1), {
              cwd: opts?.cwd,
              env: opts?.env,
              extendEnv: true,
            }),
          )
          return result.stdout.toString("utf8")
        },
        Effect.catch(() => Effect.succeed("")),
      )

      const run = Effect.fnUntraced(
        function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
          const result = yield* appProcess.run(
            ChildProcess.make(cmd[0], cmd.slice(1), {
              cwd: opts?.cwd,
              env: opts?.env,
              extendEnv: true,
            }),
          )
          return {
            code: result.exitCode,
            stdout: result.stdout.toString("utf8"),
            stderr: result.stderr.toString("utf8"),
          }
        },
        Effect.catch((err) => Effect.succeed({ code: 1, stdout: "", stderr: errorMessage(err) })),
      )

      const getBrewFormula = Effect.fnUntraced(function* () {
        const tapFormula = yield* text(["brew", "list", "--formula", "anomalyco/tap/prioricode"])
        if (tapFormula.includes("prioricode")) return "anomalyco/tap/prioricode"
        const coreFormula = yield* text(["brew", "list", "--formula", "prioricode"])
        if (coreFormula.includes("prioricode")) return "prioricode"
        return "prioricode"
      })

      const upgradeFailure = (method: Method, result?: { code: number; stdout: string; stderr: string }) => {
        if (method === "choco") return "not running from an elevated command shell"
        if (result) return `Upgrade failed for ${method} (exit code ${result.code}).`
        return `Upgrade failed for ${method}.`
      }

      const upgradeScriptShell = Effect.fnUntraced(function* () {
        const bashVersion = yield* text(["bash", "--version"])
        if (bashVersion) return "bash"
        return "sh"
      })

      // Fetches the installer script for a curl upgrade. The copy served from
      // code.prioritech.co.id/install(.ps1) is a manually-synced static file
      // (it was observed still serving the pre-September installer while main
      // had moved on) — running it would silently undo the very fixes this
      // upgrade ships. Fetch the installer pinned to the target release's own
      // tag first: that source is authoritative, version-matched, and updated
      // by every release automatically. The custom domain stays as a fallback
      // for networks that block github/raw.githubusercontent entirely.
      const fetchInstaller = Effect.fnUntraced(function* (file: string, target: string) {
        return yield* httpOk
          .execute(
            HttpClientRequest.get(
              `https://raw.githubusercontent.com/Prioritech-Indonesia-Optima/prioricode/v${target}/${file}`,
            ),
          )
          .pipe(
            Effect.flatMap((response) => response.text),
            Effect.catch(() =>
              Effect.gen(function* () {
                const response = yield* httpOk.execute(HttpClientRequest.get(`https://code.prioritech.co.id/${file}`))
                return yield* response.text
              }),
            ),
          )
      })

      const upgradeCurl = Effect.fnUntraced(
        function* (target: string) {
          const installEnv: Record<string, string> = {
            VERSION: target,
            PRIORICODE_INSTALL_DIR: path.dirname(process.execPath),
          }

          if (process.platform === "win32") {
            // Run the installer from a local pinned copy instead of
            // `irm <domain>/install.ps1 | iex`: a domain-only fetch has no
            // fallback inside PowerShell, and self-upgrading means the
            // installer runs while prioricode.exe is still executing —
            // install.ps1 handles the locked-image swap itself.
            const body = yield* fetchInstaller("install.ps1", target)
            const scriptPath = path.join(os.tmpdir(), `prioricode-install-${target}-${process.pid}.ps1`)
            const result = yield* fs.writeFileString(scriptPath, body).pipe(
              Effect.andThen(
                appProcess.run(
                  ChildProcess.make(
                    "powershell.exe",
                    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
                    {
                      env: installEnv,
                      extendEnv: true,
                    },
                  ),
                ),
              ),
              Effect.ensuring(fs.remove(scriptPath).pipe(Effect.ignore)),
            )
            return {
              code: result.exitCode,
              stdout: result.stdout.toString("utf8"),
              stderr: result.stderr.toString("utf8"),
            }
          }

          const body = yield* fetchInstaller("install", target)
          const bodyBytes = new TextEncoder().encode(body)
          const shell = yield* upgradeScriptShell()
          const result = yield* appProcess.run(
            ChildProcess.make(shell, [], {
              stdin: Stream.make(bodyBytes),
              env: installEnv,
              extendEnv: true,
            }),
          )
          return {
            code: result.exitCode,
            stdout: result.stdout.toString("utf8"),
            stderr: result.stderr.toString("utf8"),
          }
        },
        Effect.mapError(() => new UpgradeFailedError({ stderr: upgradeFailure("curl") })),
      )

      const result: Interface = {
        info: Effect.fn("Installation.info")(function* () {
          return {
            version: InstallationVersion,
            latest: yield* result.latest(),
          }
        }),
        method: Effect.fn("Installation.method")(function* () {
          if (process.execPath.includes(path.join(".prioricode", "bin"))) return "curl" as Method
          if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
          if (process.execPath.startsWith(path.join(os.homedir(), "bin") + path.sep)) return "curl" as Method
          const exec = process.execPath.toLowerCase()

          const checks: Array<{ name: Method; command: () => Effect.Effect<string> }> = [
            { name: "npm", command: () => text(["npm", "list", "-g", "--depth=0"]) },
            { name: "yarn", command: () => text(["yarn", "global", "list"]) },
            { name: "pnpm", command: () => text(["pnpm", "list", "-g", "--depth=0"]) },
            { name: "bun", command: () => text(["bun", "pm", "ls", "-g"]) },
            { name: "brew", command: () => text(["brew", "list", "--formula", "prioricode"]) },
            { name: "scoop", command: () => text(["scoop", "list", "prioricode"]) },
            { name: "choco", command: () => text(["choco", "list", "--limit-output", "prioricode"]) },
          ]

          checks.sort((a, b) => {
            const aMatches = exec.includes(a.name)
            const bMatches = exec.includes(b.name)
            if (aMatches && !bMatches) return -1
            if (!aMatches && bMatches) return 1
            return 0
          })

          for (const check of checks) {
            const output = yield* check.command()
            const installedName =
              check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "prioricode" : "prioricode-ai"
            if (output.includes(installedName)) {
              return check.name
            }
          }

          return "unknown" as Method
        }),
        latest: Effect.fn("Installation.latest")(function* (installMethod?: Method) {
          const detectedMethod = installMethod || (yield* result.method())

          if (detectedMethod === "brew") {
            const formula = yield* getBrewFormula()
            if (formula.includes("/")) {
              const infoJson = yield* text(["brew", "info", "--json=v2", formula])
              const info = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BrewInfoV2))(infoJson)
              return info.formulae[0].versions.stable
            }
            const response = yield* httpOk.execute(
              HttpClientRequest.get("https://formulae.brew.sh/api/formula/prioricode.json").pipe(
                HttpClientRequest.acceptJson,
              ),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(BrewFormula)(response)
            return data.versions.stable
          }

          if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
            const response = yield* httpOk.execute(
              HttpClientRequest.get(
                `${yield* NpmConfig.registry(process.cwd())}/prioricode-ai/${InstallationChannel}`,
              ).pipe(HttpClientRequest.acceptJson),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(NpmPackage)(response)
            return data.version
          }

          if (detectedMethod === "choco") {
            const response = yield* httpOk.execute(
              HttpClientRequest.get(
                "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27prioricode%27%20and%20IsLatestVersion&$select=Version",
              ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json;odata=verbose" })),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(ChocoPackage)(response)
            return data.d.results[0].Version
          }

          if (detectedMethod === "scoop") {
            const response = yield* httpOk.execute(
              HttpClientRequest.get(
                "https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/prioricode.json",
              ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json" })),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(ScoopManifest)(response)
            return data.version
          }

          const response = yield* httpOk.execute(
            HttpClientRequest.get(
              "https://api.github.com/repos/Prioritech-Indonesia-Optima/prioricode/releases/latest",
            ).pipe(HttpClientRequest.acceptJson),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(GitHubRelease)(response)
          return data.tag_name.replace(/^v/, "")
        }, Effect.orDie),
        upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {
          let upgradeResult: { code: number; stdout: string; stderr: string } | undefined
          switch (m) {
            case "curl":
              upgradeResult = yield* upgradeCurl(target)
              break
            case "npm":
              upgradeResult = yield* run(["npm", "install", "-g", `prioricode-ai@${target}`])
              break
            case "pnpm":
              upgradeResult = yield* run(["pnpm", "install", "-g", `prioricode-ai@${target}`])
              break
            case "bun":
              upgradeResult = yield* run(["bun", "install", "-g", `prioricode-ai@${target}`])
              break
            case "brew": {
              const formula = yield* getBrewFormula()
              const env = { HOMEBREW_NO_AUTO_UPDATE: "1" }
              if (formula.includes("/")) {
                const tap = yield* run(["brew", "tap", "anomalyco/tap"], { env })
                if (tap.code !== 0) {
                  upgradeResult = tap
                  break
                }
                const repo = yield* text(["brew", "--repo", "anomalyco/tap"])
                const dir = repo.trim()
                if (dir) {
                  const pull = yield* run(["git", "pull", "--ff-only"], { cwd: dir, env })
                  if (pull.code !== 0) {
                    upgradeResult = pull
                    break
                  }
                }
              }
              upgradeResult = yield* run(["brew", "upgrade", formula], { env })
              break
            }
            case "choco":
              upgradeResult = yield* run(["choco", "upgrade", "prioricode", `--version=${target}`, "-y"])
              break
            case "scoop":
              upgradeResult = yield* run(["scoop", "install", `prioricode@${target}`])
              break
            default:
              return yield* new UpgradeFailedError({ stderr: `Unknown installation method: ${m}` })
          }
          if (!upgradeResult || upgradeResult.code !== 0) {
            return yield* new UpgradeFailedError({ stderr: upgradeFailure(m, upgradeResult) })
          }
          // The installer exits 0 when the target binary already "looks" right,
          // so confirm the binary at this exact path really reports the target
          // version. Without this a no-op install (e.g. a stale PATH copy) is
          // reported to the user as a successful upgrade. Skipped for dev runs
          // where execPath is bun itself rather than an installed prioricode.
          if (m === "curl" && path.basename(process.execPath).toLowerCase().startsWith("prioricode")) {
            const installed = yield* run([process.execPath, "--version"])
            const version = installed.stdout.trim()
            if (installed.code !== 0) {
              return yield* new UpgradeFailedError({
                stderr: `Upgrade did not produce a runnable binary: ${
                  installed.stderr.trim().split("\n").pop() || `exit ${installed.code}`
                }`,
              })
            }
            if (version !== target) {
              return yield* new UpgradeFailedError({
                stderr: `Upgrade reported success but ${process.execPath} still runs ${version || "an unknown version"} instead of ${target}.`,
              })
            }
          }
          yield* Effect.logInfo("upgraded", {
            method: m,
            target,
            stdout: upgradeResult.stdout,
            stderr: upgradeResult.stderr,
          })
        }),
      }

      return Service.of(result)
    }),
  )

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [httpClient, AppProcess.node, filesystem],
})

const { runPromise } = makeRuntime(Service, AppNodeBuilder.build(node))

export const latest = (...args: Parameters<Interface["latest"]>) => runPromise((s) => s.latest(...args))
export const method = () => runPromise((s) => s.method())
export const upgrade = (...args: Parameters<Interface["upgrade"]>) => runPromise((s) => s.upgrade(...args))

export * as Installation from "."
