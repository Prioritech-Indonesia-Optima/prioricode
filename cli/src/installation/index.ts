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
import { isMissingShell, windowsShellCandidates } from "./windows-shell"

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

export const UPGRADE_CAUSES = [
  "command-failed",
  "shell-not-found",
  "locked-binary",
  "elevation-required",
  "verification-failed",
] as const
export type UpgradeCause = (typeof UPGRADE_CAUSES)[number]

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
  cause: Schema.optional(Schema.Literals(UPGRADE_CAUSES)),
  target: Schema.optional(Schema.String),
}) {
  override get message() {
    const remediation = upgradeRemediation(this.cause)
    return remediation ? `${this.stderr} ${remediation}` : this.stderr
  }
}

// One cause→remediation table so the CLI, the HTTP handler, and the TUI all
// render the same actionable hint instead of re-matching locale-fragile
// stderr substrings at each call site.
export function upgradeRemediation(cause?: UpgradeCause): string | undefined {
  switch (cause) {
    case "elevation-required":
      return "Please run the terminal as Administrator and try again."
    case "locked-binary":
      return "Close all running PrioriCode terminals and editors, then retry."
    case "shell-not-found":
      return "Install Windows PowerShell 5.1 or pwsh 7, or update manually from the GitHub Releases page."
    case "verification-failed":
      return "The upgrade did not take effect; if it repeats, reinstall from the GitHub Releases page."
    case "command-failed":
    case undefined:
      return undefined
  }
}

// Pure failure classifier: sanitized, deterministic, cause-tagged messages.
// Never echoes raw command output — package-manager stderr has leaked tokens
// in the past, and localized choco output cannot be matched verbatim.
export function classifyUpgradeFailure(
  method: Method,
  platform: NodeJS.Platform,
  result?: { code: number; stderr: string },
): { stderr: string; cause: UpgradeCause } {
  const stderr = result?.stderr ?? ""
  if (method === "choco" && /elevat/i.test(stderr))
    return { stderr: "not running from an elevated command shell", cause: "elevation-required" }
  if (platform === "win32" && /EPERM|EBUSY|being used by another process/i.test(stderr))
    return { stderr: `Upgrade failed for ${method} (exit code ${result?.code}).`, cause: "locked-binary" }
  if (result) return { stderr: `Upgrade failed for ${method} (exit code ${result.code}).`, cause: "command-failed" }
  return { stderr: `Upgrade failed for ${method}.`, cause: "command-failed" }
}

// A 200 response can still be an HTML error/captive-portal page or an empty
// body; refuse to pipe that into a shell. Real installers (both the bash and
// PowerShell variants) always mention "install", so this also catches gross
// truncation without rejecting legitimate release copies.
function installerBodyLooksValid(body: string) {
  const text = body.trim()
  if (!text) return false
  if (/^<(!doctype|html)/i.test(text)) return false
  return /install/i.test(text)
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

      const fail = (method: Method, result?: { code: number; stdout: string; stderr: string }, target?: string) => {
        const classified = classifyUpgradeFailure(method, process.platform, result)
        return new UpgradeFailedError({ stderr: classified.stderr, cause: classified.cause, target })
      }

      // Post-upgrade truth check. `curl` confirms the exact binary path;
      // package managers are confirmed from their own list output (never by
      // exec'ing through PATH, which can resolve a different copy). A concrete
      // version that differs from the target proves the "successful" command
      // left the install stale (Windows EBUSY, PATH shims, half swaps). An
      // empty or unparsable result is unverifiable, not a false failure.
      const verifyInstall = Effect.fnUntraced(function* (m: Method, target: string) {
        if (m === "curl") {
          if (!path.basename(process.execPath).toLowerCase().startsWith("prioricode")) return
          const installed = yield* run([process.execPath, "--version"])
          if (installed.code !== 0) return `Upgrade did not produce a runnable binary (exit ${installed.code}).`
          const version = installed.stdout.trim()
          if (version !== target)
            return `Upgrade reported success but ${process.execPath} still runs ${version || "an unknown version"} instead of ${target}.`
          return
        }
        const formula = m === "brew" ? yield* getBrewFormula() : undefined
        const probe: { command: string[]; pattern: RegExp; label: string } | undefined =
          m === "npm"
            ? {
                command: ["npm", "list", "-g", "--depth=0", "prioricode-ai"],
                pattern: /prioricode-ai@(\d+\.\d+\.\d+[^\s()]*)/,
                label: "prioricode-ai",
              }
            : m === "pnpm"
              ? {
                  command: ["pnpm", "list", "-g", "prioricode-ai"],
                  pattern: /prioricode-ai (\d+\.\d+\.\d+[^\s]*)/,
                  label: "prioricode-ai",
                }
              : m === "bun"
                ? {
                    command: ["bun", "pm", "ls", "-g"],
                    pattern: /prioricode-ai@(\d+\.\d+\.\d+[^\s]*)/,
                    label: "prioricode-ai",
                  }
                : m === "yarn"
                  ? {
                      command: ["yarn", "global", "list"],
                      pattern: /prioricode-ai@(\d+\.\d+\.\d+[^\s"]*)/,
                      label: "prioricode-ai",
                    }
                  : m === "scoop"
                    ? {
                        command: ["scoop", "list", "prioricode"],
                        pattern: /prioricode\s+v?(\d+\.\d+\.\d+[^\s]*)/,
                        label: "prioricode",
                      }
                    : m === "choco"
                      ? {
                          command: ["choco", "list", "--limit-output", "prioricode"],
                          pattern: /prioricode\|(\d+\.\d+\.\d+[^\s|]*)/,
                          label: "prioricode",
                        }
                      : m === "brew" && formula
                        ? {
                            command: ["brew", "list", "--versions", formula],
                            pattern: /prioricode\s+(\d+\.\d+\.\d+[^\s]*)/,
                            label: formula,
                          }
                        : undefined
        if (!probe) return
        const output = yield* text(probe.command)
        const reported = output.match(probe.pattern)?.[1]
        if (reported && semver.valid(reported) && semver.neq(reported, target)) {
          return `Upgrade reported success but ${m} still lists ${probe.label} at ${reported} instead of ${target}.`
        }
      })

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

          const rejected = (stderr: string, failure: UpgradeCause) => ({
            code: 1,
            stdout: "",
            stderr,
            failure,
          })

          if (process.platform === "win32") {
            // Run the installer from a local pinned copy instead of
            // `irm <domain>/install.ps1 | iex`: a domain-only fetch has no
            // fallback inside PowerShell, and self-upgrading means the
            // installer runs while prioricode.exe is still executing —
            // install.ps1 handles the locked-image swap itself.
            const body = yield* fetchInstaller("install.ps1", target)
            if (!installerBodyLooksValid(body))
              return rejected("Upgrade failed for curl: fetched installer was empty or not a script.", "command-failed")
            const scriptPath = path.join(os.tmpdir(), `prioricode-install-${target}-${process.pid}.ps1`)
            let result = { code: 1, stdout: "", stderr: "no Windows PowerShell or pwsh installation was found" }
            const ran = yield* fs.writeFileString(scriptPath, body).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  for (const shell of windowsShellCandidates(process.env)) {
                    const spawned = yield* run(
                      [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
                      {
                        env: installEnv,
                      },
                    )
                    // ENOENT means this candidate is absent; a real nonzero
                    // exit is the installer's own verdict and must propagate.
                    if (isMissingShell(spawned.stderr)) continue
                    result = spawned
                    return true
                  }
                  return false
                }),
              ),
              Effect.ensuring(fs.remove(scriptPath).pipe(Effect.ignore)),
            )
            if (!ran) return rejected(result.stderr, "shell-not-found")
            return result
          }

          const posixBody = yield* fetchInstaller("install", target)
          if (!installerBodyLooksValid(posixBody))
            return rejected("Upgrade failed for curl: fetched installer was empty or not a script.", "command-failed")
          const bodyBytes = new TextEncoder().encode(posixBody)
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
        Effect.mapError(() => new UpgradeFailedError({ stderr: "Upgrade failed for curl.", cause: "command-failed" })),
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
          let upgradeResult: { code: number; stdout: string; stderr: string; failure?: UpgradeCause } | undefined
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
              return yield* new UpgradeFailedError({ stderr: `Unknown installation method: ${m}`, target })
          }
          if (upgradeResult?.failure) {
            return yield* new UpgradeFailedError({ stderr: upgradeResult.stderr, cause: upgradeResult.failure, target })
          }
          if (!upgradeResult || upgradeResult.code !== 0) {
            return yield* fail(m, upgradeResult, target)
          }
          // Package managers can exit 0 while the requested version did not
          // actually land (stale PATH copy, pinned-but-present, offline
          // no-op). Verify from the manager's own state — never by exec'ing
          // `prioricode --version` through PATH, which can resolve a
          // different copy than the one just upgraded.
          const verify = yield* verifyInstall(m, target)
          if (verify) return yield* new UpgradeFailedError({ stderr: verify, cause: "verification-failed", target })
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
