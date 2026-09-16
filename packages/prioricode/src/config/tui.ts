export * as TuiConfig from "./tui"

import path from "path"
import { mergeDeep, unique } from "remeda"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Cause, Context, Effect, Fiber, Layer } from "effect"
import { ConfigParse } from "@/config/parse"
import * as ConfigPaths from "@/config/paths"
import { ConfigPatch } from "@/config/patch"
import { migrateTuiConfig } from "./tui-migrate"
import { resolveHostAttentionSoundPaths } from "./tui-host-attention"
import { Flag } from "@prioricode/core/flag/flag"
import { isRecord } from "@prioricode/tui/util/record"
import { Global } from "@prioricode/core/global"
import { FSUtil } from "@prioricode/core/fs-util"
import { CurrentWorkingDirectory } from "./tui-cwd"
import { ConfigPlugin } from "@/config/plugin"
import { TuiKeybind } from "@prioricode/tui/config/keybind"
import { InstallationLocal, InstallationVersion } from "@prioricode/core/installation/version"
import { makeRuntime } from "@prioricode/core/effect/runtime"
import { Filesystem } from "@/util/filesystem"
import { ConfigVariable } from "@/config/variable"
import { Npm } from "@prioricode/core/npm"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { TuiConfig } from "@prioricode/tui/config"

export const Info = TuiConfig.Info
export type Info = TuiConfig.Info

type Acc = {
  result: Info
  plugin_origins: ConfigPlugin.Origin[]
}

export type Resolved = TuiConfig.Resolved

export type HostMetadata = {
  plugin_origins?: ConfigPlugin.Origin[]
}

export interface Interface {
  readonly get: () => Effect.Effect<Resolved>
  readonly updatePatch: (patch: Partial<Info>) => Effect.Effect<void, Error>
  readonly pluginOrigins: () => Effect.Effect<ConfigPlugin.Origin[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/TuiConfig") {}

function pluginScope(file: string, ctx: { directory: string }): ConfigPlugin.Scope {
  if (Filesystem.contains(ctx.directory, file)) return "local"
  // if (ctx.worktree !== "/" && Filesystem.contains(ctx.worktree, file)) return "local"
  return "global"
}

function normalize(raw: Record<string, unknown>) {
  const data = { ...raw }
  if (!("tui" in data)) return data
  if (!isRecord(data.tui)) {
    delete data.tui
    return data
  }

  const tui = data.tui
  delete data.tui
  return {
    ...tui,
    ...data,
  }
}

function dropUnknownKeybinds(input: Record<string, unknown>) {
  if (!isRecord(input.keybinds)) return input

  const invalid = TuiKeybind.unknownKeys(input.keybinds)
  if (!invalid.length) return input

  return {
    ...input,
    keybinds: Object.fromEntries(Object.entries(input.keybinds).filter(([key]) => !invalid.includes(key))),
  }
}

const loadState = Effect.fn("TuiConfig.loadState")(function* (ctx: { directory: string }) {
  const afs = yield* FSUtil.Service
  let appliedOrder = 0
  const tried: string[] = []

  const resolvePlugins = (config: Info, configFilepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const plugins = config.plugin
      if (!plugins) return config
      return {
        ...config,
        plugin: yield* Effect.forEach(plugins, (plugin) =>
          Effect.promise(() => ConfigPlugin.resolvePluginSpec(plugin as ConfigPlugin.Origin["spec"], configFilepath)),
        ),
      }
    })

  const load = (text: string, configFilepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute({ text, type: "path", path: configFilepath, missing: "empty" }),
      )
      const data = ConfigParse.jsonc(expanded, configFilepath)
      if (!isRecord(data)) return {} as Info
      // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
      // (mirroring the old prioricode.json shape) still get their settings applied.
      const normalized = dropUnknownKeybinds(normalize(data))
      const parsed = ConfigParse.schema(Info, normalized, configFilepath)
      const validated = parsed.attention?.sounds
        ? {
            ...parsed,
            attention: {
              ...parsed.attention,
              sounds: resolveHostAttentionSoundPaths(path.dirname(configFilepath), parsed.attention.sounds),
            },
          }
        : parsed
      return yield* resolvePlugins(validated, configFilepath)
    }).pipe(
      // catchCause (not tapErrorCause + orElseSucceed) because JSONC parsing and validation
      // can sync-throw — those become defects, which orElseSucceed wouldn't catch.
      Effect.catchCause((cause) =>
        Effect.logWarning("skipping invalid tui config", {
          path: configFilepath,
          reason: FormatError(Cause.squash(cause)) ?? FormatUnknownError(Cause.squash(cause)),
        }).pipe(Effect.as({} as Info)),
      ),
    )

  const loadFile = (filepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      // Silent-swallow non-NotFound read errors (perms, EISDIR, IO) → log + skip.
      // Matches how parse/schema/plugin failures in load() are handled — every
      // broken-config path degrades gracefully rather than crashing TUI startup.
      const text = yield* afs.readFileStringSafe(filepath).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to read tui config", {
            path: filepath,
            reason: FormatError(Cause.squash(cause)) ?? FormatUnknownError(Cause.squash(cause)),
          }).pipe(Effect.as(undefined)),
        ),
      )
      if (!text) return {} as Info
      yield* Effect.logInfo("loading tui config", { path: filepath })
      return yield* load(text, filepath)
    })

  const mergeFile = (acc: Acc, file: string) =>
    Effect.gen(function* () {
      tried.push(file)
      const data = yield* loadFile(file)
      if (Object.keys(data).length) {
        appliedOrder += 1
        yield* Effect.logInfo("applying tui config", { path: file, order: appliedOrder })
      }
      acc.result = mergeDeep(acc.result, data)
      if (!data.plugin?.length) return

      const scope = pluginScope(file, ctx)
      const plugins = ConfigPlugin.deduplicatePluginOrigins([
        ...acc.plugin_origins,
        ...data.plugin.map((spec) => ({ spec: spec as ConfigPlugin.Origin["spec"], scope, source: file })),
      ])
      acc.result = {
        ...acc.result,
        plugin: plugins.map((item) => item.spec),
      }
      acc.plugin_origins = plugins
    })

  // Every config dir we may read from: global config dir, any `.prioricode`
  // folders between cwd and home, and PRIORICODE_CONFIG_DIR.
  const directories = yield* ConfigPaths.directories(ctx.directory)
  yield* Effect.promise(() => migrateTuiConfig({ directories, cwd: ctx.directory }))

  const projectFiles = Flag.PRIORICODE_DISABLE_PROJECT_CONFIG ? [] : yield* ConfigPaths.files("tui", ctx.directory)

  const acc: Acc = {
    result: {},
    plugin_origins: [],
  }

  // 1. Global tui config (lowest precedence).
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    yield* mergeFile(acc, file)
  }

  // 2. Explicit PRIORICODE_TUI_CONFIG override, if set.
  if (Flag.PRIORICODE_TUI_CONFIG) {
    const configFile = Flag.PRIORICODE_TUI_CONFIG
    yield* mergeFile(acc, configFile)
    yield* Effect.logDebug("loaded custom tui config", { path: configFile })
  }

  // 3. Project tui files, applied root-first so the closest file wins.
  for (const file of projectFiles) {
    yield* mergeFile(acc, file)
  }

  // 4. `.prioricode` directories (and PRIORICODE_CONFIG_DIR) discovered while
  // walking up the tree. Also returned below so callers can install plugin
  // dependencies from each location.
  const dirs = unique(directories).filter((dir) => dir.endsWith(".prioricode") || dir === Flag.PRIORICODE_CONFIG_DIR)

  for (const dir of dirs) {
    if (!dir.endsWith(".prioricode") && dir !== Flag.PRIORICODE_CONFIG_DIR) continue
    for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
      yield* mergeFile(acc, file)
    }
  }

  const result = TuiConfig.resolve(
    {
      ...acc.result,
    },
    {
      terminalSuspend: process.platform !== "win32",
    },
  )

  return {
    config: result,
    files: unique(tried),
    pluginOrigins: acc.plugin_origins,
    dirs: result.plugin?.length ? dirs : [],
  }
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const directory = yield* CurrentWorkingDirectory
    const afs = yield* FSUtil.Service
    const npm = yield* Npm.Service
    const data = yield* loadState({ directory })
    const deps = yield* Effect.forEach(
      data.dirs,
      (dir) =>
        npm
          .install(dir, {
            add: [
              {
                name: "@prioricode/plugin",
                version: InstallationLocal ? undefined : InstallationVersion,
              },
            ],
          })
          .pipe(Effect.forkScoped),
      {
        concurrency: "unbounded",
      },
    )

    const get = Effect.fn("TuiConfig.get")(() => Effect.succeed(data.config))
    const pluginOrigins = Effect.fn("TuiConfig.pluginOrigins")(() => Effect.succeed(data.pluginOrigins))

    const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

    // Settings changes persist to the highest-precedence tui config file that
    // exists (so the value written is the value the next load resolves), and
    // fall back to the global file when no tui config exists yet.
    const updatePatch = Effect.fn("TuiConfig.updatePatch")(function* (patch: Partial<Info>) {
      const { keybinds: _keybinds, ...writable } = patch
      if (Object.keys(writable).length === 0) return

      let target = path.join(Global.Path.config, "tui.json")
      let before = "{}"
      for (const file of data.files.toReversed()) {
        const text = yield* afs.readFileStringSafe(file).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        if (text === undefined) continue
        target = file
        before = text
        break
      }

      const merged = yield* Effect.try({
        try: () => {
          const existing = ConfigParse.jsonc(before, target)
          const next = mergeDeep(isRecord(existing) ? existing : {}, writable)
          ConfigParse.schema(Info, next, target)
          return next
        },
        catch: toError,
      })

      const text = yield* Effect.try({
        try: () => {
          try {
            return ConfigPatch.patchJsonc(before, writable)
          } catch {
            return JSON.stringify(merged, null, 2)
          }
        },
        catch: toError,
      })

      yield* afs.writeFileString(target, text).pipe(Effect.mapError(toError))
      yield* Effect.logInfo("updated tui config", { path: target })
    })

    const waitForDependencies = Effect.fn("TuiConfig.waitForDependencies")(() =>
      Effect.forEach(deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.ignore(), Effect.asVoid),
    )
    return Service.of({ get, updatePatch, pluginOrigins, waitForDependencies })
  }).pipe(Effect.withSpan("TuiConfig.layer")),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Npm.node, FSUtil.node] })

const { runPromise } = makeRuntime(Service, AppNodeBuilder.build(node))

export async function waitForDependencies() {
  await runPromise((svc) => svc.waitForDependencies())
}

export async function get() {
  return runPromise((svc) => svc.get())
}

export async function updatePatch(patch: Partial<Info>) {
  await runPromise((svc) => svc.updatePatch(patch))
}

export async function pluginOrigins() {
  return runPromise((svc) => svc.pluginOrigins())
}
