import { describe, expect } from "bun:test"
import { makeGlobalNode } from "@prioricode/core/effect/app-node"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { filesystem, httpClient } from "@prioricode/core/effect/app-node-platform"
import { Effect, FileSystem, Layer, Stream } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { InstallationChannel } from "@prioricode/core/installation/version"
import { CrossSpawnSpawner } from "@prioricode/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(
  handler: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string } = () =>
    "",
) {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const result = handler(std?.command ?? "", std?.args ?? [])
    const output = typeof result === "string" ? { code: 0, stdout: result, stderr: "" } : result
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output.code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output.stdout ? Stream.make(encoder.encode(output.stdout)) : Stream.empty,
        stderr: output.stderr ? Stream.make(encoder.encode(output.stderr)) : Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string },
) {
  const spawnerNode = makeGlobalNode({
    service: ChildProcessSpawner.ChildProcessSpawner,
    layer: mockSpawner(spawnHandler),
    deps: [],
  })
  const fsNode = makeGlobalNode({
    service: FileSystem.FileSystem,
    layer: NodeFileSystem.layer,
    deps: [],
  })
  return LayerNode.compile(Installation.node, [
    [httpClient, mockHttpClient(httpHandler)],
    [CrossSpawnSpawner.node, spawnerNode],
    [filesystem, fsNode],
  ])
}

const withPlatform = <A, E, R>(platform: typeof process.platform, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const original = Object.getOwnPropertyDescriptor(process, "platform")
      Object.defineProperty(process, "platform", { ...original, value: platform })
      return original
    }),
    () => self,
    (original: PropertyDescriptor | undefined) =>
      Effect.sync(() => {
        if (original) Object.defineProperty(process, "platform", original)
      }),
  )

describe("installation", () => {
  describe("latest", () => {
    testEffect(testLayer(() => jsonResponse({ tag_name: "v1.2.3" }))).effect(
      "reads release version from GitHub releases",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("unknown")
          expect(result).toBe("1.2.3")
        }),
    )

    testEffect(testLayer(() => jsonResponse({ tag_name: "v4.0.0-beta.1" }))).effect(
      "strips v prefix from GitHub release tag",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("curl")
          expect(result).toBe("4.0.0-beta.1")
        }),
    )

    const npmCalls: string[] = []
    testEffect(
      testLayer((request) => {
        npmCalls.push(request.url)
        return jsonResponse({ version: "1.5.0" })
      }),
    ).effect("reads npm versions via registry", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("npm")
        expect(result).toBe("1.5.0")
        expect(npmCalls).toContain(`https://registry.npmjs.org/prioricode-ai/${InstallationChannel}`)
      }),
    )

    const bunCalls: string[] = []
    testEffect(
      testLayer((request) => {
        bunCalls.push(request.url)
        return jsonResponse({ version: "1.6.0" })
      }),
    ).effect("reads bun versions via registry", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("bun")
        expect(result).toBe("1.6.0")
        expect(bunCalls).toContain(`https://registry.npmjs.org/prioricode-ai/${InstallationChannel}`)
      }),
    )

    const pnpmCalls: string[] = []
    testEffect(
      testLayer((request) => {
        pnpmCalls.push(request.url)
        return jsonResponse({ version: "1.7.0" })
      }),
    ).effect("reads pnpm versions via registry", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("pnpm")
        expect(result).toBe("1.7.0")
        expect(pnpmCalls).toContain(`https://registry.npmjs.org/prioricode-ai/${InstallationChannel}`)
      }),
    )

    testEffect(testLayer(() => jsonResponse({ version: "2.3.4" }))).effect("reads scoop manifest versions", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("scoop")
        expect(result).toBe("2.3.4")
      }),
    )

    testEffect(testLayer(() => jsonResponse({ d: { results: [{ Version: "3.4.5" }] } }))).effect(
      "reads chocolatey feed versions",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("choco")
          expect(result).toBe("3.4.5")
        }),
    )

    testEffect(
      testLayer(
        () => jsonResponse({ versions: { stable: "2.0.0" } }),
        (cmd, args) => {
          // getBrewFormula: return core formula (no tap)
          if (cmd === "brew" && args.includes("--formula") && args.includes("anomalyco/tap/prioricode")) return ""
          if (cmd === "brew" && args.includes("--formula") && args.includes("prioricode")) return "prioricode"
          return ""
        },
      ),
    ).effect("reads brew formulae API versions", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("brew")
        expect(result).toBe("2.0.0")
      }),
    )

    const brewInfoJson = JSON.stringify({
      formulae: [{ versions: { stable: "2.1.0" } }],
    })
    testEffect(
      testLayer(
        () => jsonResponse({}), // HTTP not used for tap formula
        (cmd, args) => {
          if (cmd === "brew" && args.includes("anomalyco/tap/prioricode") && args.includes("--formula"))
            return "prioricode"
          if (cmd === "brew" && args.includes("--json=v2")) return brewInfoJson
          return ""
        },
      ),
    ).effect("reads brew tap info JSON via CLI", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("brew")
        expect(result).toBe("2.1.0")
      }),
    )
  })

  describe("upgrade", () => {
    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd) => {
          if (cmd === "npm") return { code: 1, stderr: "token=secret command output" }
          return ""
        },
      ),
    ).effect("returns sanitized typed errors for failed package upgrades", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Installation.use.upgrade("npm", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toBe("Upgrade failed for npm (exit code 1).")
        expect(error.message).toBe(error.stderr)
        expect(error.stderr).not.toContain("secret")
        expect(error.stderr).not.toContain("command output")
      }),
    )

    testEffect(
      testLayer(
        () => new Response("install script with token=secret", { status: 200 }),
        (cmd, args) => {
          if (cmd === "bash" && args[0] === "--version") return "GNU bash"
          if (cmd === "bash" || cmd === "sh") return { code: 1, stderr: "script output with token=secret" }
          return ""
        },
      ),
    ).effect("returns sanitized typed errors when the curl install script fails", () =>
      withPlatform(
        "linux",
        Effect.gen(function* () {
          const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
          expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
          expect(error.stderr).toBe("Upgrade failed for curl (exit code 1).")
          expect(error.message).toBe(error.stderr)
          expect(error.stderr).not.toContain("secret")
          expect(error.stderr).not.toContain("script output")
        }),
      ),
    )

    testEffect(
      testLayer(
        () => new Response("install script", { status: 200 }),
        (cmd, args) => {
          if (cmd === "bash" && args[0] === "--version") return { code: 1, stderr: "missing" }
          if (cmd === "bash") return { code: 1, stderr: "should not execute installer with bash" }
          if (cmd === "sh") return "ok"
          return ""
        },
      ),
    ).effect("falls back to sh when bash is unavailable during curl upgrade", () =>
      withPlatform(
        "linux",
        Effect.gen(function* () {
          yield* Installation.use.upgrade("curl", "9.9.9")
        }),
      ),
    )

    const posixPrimaryUrls: string[] = []
    testEffect(
      testLayer(
        (request) => {
          posixPrimaryUrls.push(request.url)
          return request.url.includes("raw.githubusercontent.com")
            ? new Response("pinned installer", { status: 200 })
            : new Response("stale domain copy must never win", { status: 403 })
        },
        (cmd, args) => {
          if (cmd === "bash" && args[0] === "--version") return "GNU bash"
          return ""
        },
      ),
    ).effect("curl upgrade fetches the tag-pinned installer, not the manually-synced domain copy", () =>
      withPlatform(
        "linux",
        Effect.gen(function* () {
          yield* Installation.use.upgrade("curl", "9.9.9")
          expect(posixPrimaryUrls).toContain(
            "https://raw.githubusercontent.com/Prioritech-Indonesia-Optima/prioricode/v9.9.9/install",
          )
          expect(posixPrimaryUrls.some((url) => url.includes("code.prioritech.co.id"))).toBe(false)
        }),
      ),
    )

    const posixFallbackUrls: string[] = []
    testEffect(
      testLayer(
        (request) => {
          posixFallbackUrls.push(request.url)
          return request.url.includes("raw.githubusercontent.com")
            ? new Response("blocked", { status: 403 })
            : new Response("domain installer", { status: 200 })
        },
        (cmd, args) => {
          if (cmd === "bash" && args[0] === "--version") return "GNU bash"
          return ""
        },
      ),
    ).effect("falls back to the custom domain when GitHub is blocked", () =>
      withPlatform(
        "linux",
        Effect.gen(function* () {
          yield* Installation.use.upgrade("curl", "9.9.9")
          expect(posixFallbackUrls).toContain(
            "https://raw.githubusercontent.com/Prioritech-Indonesia-Optima/prioricode/v9.9.9/install",
          )
          expect(posixFallbackUrls).toContain("https://code.prioritech.co.id/install")
        }),
      ),
    )
  })

  describe("upgrade on windows", () => {
    const winUrls: string[] = []
    const winSpawns: Array<[string, readonly string[]]> = []
    testEffect(
      testLayer(
        (request) => {
          winUrls.push(request.url)
          return new Response("installer body", { status: 200 })
        },
        (cmd, args) => {
          winSpawns.push([cmd, args])
          return ""
        },
      ),
    ).effect("runs a local pinned installer copy instead of a remote irm | iex", () =>
      withPlatform(
        "win32",
        Effect.gen(function* () {
          yield* Installation.use.upgrade("curl", "9.9.9")
          expect(winUrls).toContain(
            "https://raw.githubusercontent.com/Prioritech-Indonesia-Optima/prioricode/v9.9.9/install.ps1",
          )
          const powershell = winSpawns.find(([cmd]) => cmd === "powershell.exe")
          expect(powershell).toBeDefined()
          const args = powershell![1]
          expect(args).toContain("-File")
          const script = args[args.indexOf("-File") + 1]
          expect(script.endsWith(".ps1")).toBe(true)
          // no remote one-liner must remain: the installer itself has to be able
          // to swap the locked, currently-running prioricode.exe
          expect(args.some((a) => a.includes("irm "))).toBe(false)
        }),
      ),
    )

    testEffect(
      testLayer(
        () => new Response("installer body", { status: 200 }),
        (cmd) => {
          if (cmd === "powershell.exe") return { code: 1, stderr: "prioricode.exe in use token=secret" }
          return ""
        },
      ),
    ).effect("surfaces sanitized typed errors when the windows installer fails", () =>
      withPlatform(
        "win32",
        Effect.gen(function* () {
          const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
          expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
          expect(error.stderr).toBe("Upgrade failed for curl (exit code 1).")
          expect(error.stderr).not.toContain("secret")
        }),
      ),
    )

    testEffect(
      testLayer(
        (request) => {
          winUrls.push(request.url)
          return request.url.includes("raw.githubusercontent.com")
            ? new Response("pinned installer", { status: 200 })
            : new Response("blocked", { status: 403 })
        },
        (cmd, args) => {
          winSpawns.push([cmd, args])
          return ""
        },
      ),
    ).effect("falls back to the tag-pinned GitHub install.ps1 when the custom domain is blocked", () =>
      withPlatform(
        "win32",
        Effect.gen(function* () {
          yield* Installation.use.upgrade("curl", "9.9.9")
          expect(winUrls).toContain(
            "https://raw.githubusercontent.com/Prioritech-Indonesia-Optima/prioricode/v9.9.9/install.ps1",
          )
          expect(winUrls).toContain(
            "https://raw.githubusercontent.com/Prioritech-Indonesia-Optima/prioricode/v9.9.9/install.ps1",
          )
        }),
      ),
    )

    // winSpawns accumulates across these win32 tests; clear at the start of
    // each effect body so per-test assertions only see this run's spawns.
    const shellLayer = (onSpawn?: (cmd: string) => { code: number; stdout?: string; stderr?: string } | string) =>
      testLayer(
        () => new Response("installer body", { status: 200 }),
        (cmd) => {
          winSpawns.push([cmd, []])
          return onSpawn ? onSpawn(cmd) : ""
        },
      )

    testEffect(
      shellLayer((cmd) => (cmd === "powershell.exe" ? { code: 1, stderr: "spawn powershell.exe ENOENT" } : "")),
    ).effect("uses the absolute System32 PowerShell when PATH powershell.exe is absent", () =>
      withPlatform(
        "win32",
        Effect.gen(function* () {
          winSpawns.length = 0
          yield* Installation.use.upgrade("curl", "9.9.9")
          // PATH powershell.exe returned ENOENT, then the System32 absolute
          // candidate ran (code 0) before pwsh could be attempted.
          expect(winSpawns.map(([cmd]) => cmd).filter((cmd) => cmd.includes("powershell.exe"))).toEqual([
            "powershell.exe",
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
          ])
        }),
      ),
    )

    testEffect(
      shellLayer((cmd) => {
        if (cmd === "pwsh") return ""
        if (cmd.includes("powershell")) return { code: 1, stderr: "spawn ENOENT" }
        return ""
      }),
    ).effect("falls back to pwsh when neither Windows PowerShell variant exists", () =>
      withPlatform(
        "win32",
        Effect.gen(function* () {
          winSpawns.length = 0
          yield* Installation.use.upgrade("curl", "9.9.9")
          expect(winSpawns.map(([cmd]) => cmd)).toContain("pwsh")
        }),
      ),
    )

    testEffect(
      shellLayer((cmd) => (cmd.includes("powershell") || cmd === "pwsh" ? { code: 1, stderr: "spawn ENOENT" } : "")),
    ).effect("reports shell-not-found when no windows installer shell exists", () =>
      withPlatform(
        "win32",
        Effect.gen(function* () {
          winSpawns.length = 0
          const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
          expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
          expect(error.cause).toBe("shell-not-found")
          expect(error.message).toContain("PowerShell")
        }),
      ),
    )

    testEffect(
      testLayer(
        () => new Response("<!doctype html><html><body>login</body></html>", { status: 200 }),
        (cmd) => {
          winSpawns.push([cmd, []])
          return ""
        },
      ),
    ).effect("refuses to pipe an HTML or empty body into the shell", () =>
      withPlatform(
        "win32",
        Effect.gen(function* () {
          winSpawns.length = 0
          const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
          expect(error.cause).toBe("command-failed")
          expect(error.stderr).toContain("not a script")
          expect(winSpawns.length).toBe(0)
        }),
      ),
    )
  })

  describe("upgrade causes and verification", () => {
    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd, args) => {
          if (cmd !== "npm") return ""
          if (args.includes("install"))
            return { code: 1, stderr: "EBUSY: resource busy prioricode.exe being used by another process" }
          return ""
        },
      ),
    ).effect("tags a win32 locked-binary package failure with the close-instances remediation", () =>
      withPlatform(
        "win32",
        Effect.gen(function* () {
          const error = yield* Effect.flip(Installation.use.upgrade("npm", "9.9.9"))
          expect(error.cause).toBe("locked-binary")
          expect(error.stderr).toBe("Upgrade failed for npm (exit code 1).")
          expect(error.message).toContain("Close all running PrioriCode terminals")
        }),
      ),
    )

    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd, args) => {
          if (cmd === "choco" && args.includes("list")) return "prioricode|9.9.9\n"
          if (cmd === "choco") return { code: 1, stderr: "Please run from an elevated command shell." }
          return ""
        },
      ),
    ).effect("classifies choco elevation failures by cause and appends remediation", () =>
      withPlatform(
        "win32",
        Effect.gen(function* () {
          const error = yield* Effect.flip(Installation.use.upgrade("choco", "9.9.9"))
          expect(error.cause).toBe("elevation-required")
          expect(error.message).toContain("Administrator")
        }),
      ),
    )

    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd, args) => {
          if (cmd === "npm" && args.includes("list")) return "└── prioricode-ai@0.1.0\n"
          return ""
        },
      ),
    ).effect("flags a concrete package-manager version mismatch as verification-failed", () =>
      withPlatform(
        "linux",
        Effect.gen(function* () {
          const error = yield* Effect.flip(Installation.use.upgrade("npm", "9.9.9"))
          expect(error.cause).toBe("verification-failed")
          expect(error.stderr).toContain("0.1.0")
          expect(error.stderr).toContain("9.9.9")
        }),
      ),
    )

    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd, args) => {
          if (cmd === "npm" && args.includes("list")) return ""
          return ""
        },
      ),
    ).effect("treats empty package-manager output as unverifiable, not a failure", () =>
      withPlatform(
        "linux",
        Effect.gen(function* () {
          yield* Installation.use.upgrade("npm", "9.9.9")
        }),
      ),
    )
  })
})
