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
      Effect.gen(function* () {
        const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toBe("Upgrade failed for curl (exit code 1).")
        expect(error.message).toBe(error.stderr)
        expect(error.stderr).not.toContain("secret")
        expect(error.stderr).not.toContain("script output")
      }),
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
      Effect.gen(function* () {
        yield* Installation.use.upgrade("curl", "9.9.9")
      }),
    )

    const installerUrls: string[] = []
    testEffect(
      testLayer(
        (request) => {
          installerUrls.push(request.url)
          return request.url.includes("raw.githubusercontent.com")
            ? new Response("pinned installer", { status: 200 })
            : new Response("blocked by ssl-inspecting proxy", { status: 403 })
        },
        (cmd, args) => {
          if (cmd === "bash" && args[0] === "--version") return "GNU bash"
          return ""
        },
      ),
    ).effect("falls back to the tag-pinned GitHub installer when the custom domain is blocked", () =>
      Effect.gen(function* () {
        yield* Installation.use.upgrade("curl", "9.9.9")
        expect(installerUrls).toContain("https://code.prioritech.co.id/install")
        expect(installerUrls).toContain(
          "https://raw.githubusercontent.com/Prioritech-Indonesia-Optima/prioricode/v9.9.9/install",
        )
      }),
    )
  })

  describe("upgrade on windows", () => {
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
          expect(winUrls).toContain("https://code.prioritech.co.id/install.ps1")
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
          expect(winUrls).toContain("https://code.prioritech.co.id/install.ps1")
          expect(winUrls).toContain(
            "https://raw.githubusercontent.com/Prioritech-Indonesia-Optima/prioricode/v9.9.9/install.ps1",
          )
        }),
      ),
    )
  })
})
