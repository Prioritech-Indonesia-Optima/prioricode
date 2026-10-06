export * as LSP from "./lsp"

import { Context, Effect, Layer, Schema } from "effect"
import { Config } from "../config"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { makeLocationNode } from "../effect/app-node"
import { LSPClient } from "./client"
import { LSPDiagnostic } from "./diagnostic"
import { LSPJSONRPC } from "./jsonrpc"
import { LSPServer } from "./server"

const DOCUMENT_DIAGNOSTICS_WAIT_MS = 2_500
const FORMAT_REQUEST_TIMEOUT_MS = 3_000

export const Status = Schema.Struct({
  id: Schema.String,
  root: Schema.String,
  status: Schema.Literals(["connected", "error"]),
})
export type Status = typeof Status.Type

export interface Edited {
  readonly formatted: boolean
  /** Bounded error-diagnostics report for the edited file, when the language server produced one. */
  readonly diagnostics: string | undefined
}

export interface Interface {
  readonly status: () => Effect.Effect<ReadonlyArray<Status>>
  readonly hasServers: (file: string) => Effect.Effect<boolean>
  /**
   * Best-effort observation of one freshly written file: format through the
   * language server when supported, then sync the document and collect fresh
   * diagnostics. Never fails and never blocks longer than its bounded waits.
   */
  readonly fileEdited: (file: string) => Effect.Effect<Edited>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/v2/LSP") {}

const empty: Edited = { formatted: false, diagnostics: undefined }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const registry = LSPServer.registry(Config.latest(yield* config.entries(), "lsp"))

    interface Slot {
      broken: boolean
      promise: Promise<LSPClient.Client | undefined>
    }
    const slots = new Map<string, Slot>()

    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        Promise.all(
          Array.from(slots.values(), async (slot) => {
            const client = await slot.promise.catch(() => undefined)
            await client?.shutdown().catch(() => undefined)
          }),
        ),
      ),
    )

    const definitionFor = (file: string) =>
      registry.definitions.find(
        (definition) =>
          definition.extensions.length === 0 || definition.extensions.includes(LSPJSONRPC.pathExtname(file)),
      )

    const spawn = Effect.fn("LSP.spawn")(function* (definition: LSPServer.Definition, root: string) {
      const launch = yield* Effect.tryPromise({
        try: () => definition.spawn(root, location.directory),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (launch === undefined) return undefined
      return yield* Effect.tryPromise({
        try: () =>
          LSPClient.create({
            serverID: definition.id,
            command: launch.command,
            cwd: root,
            root,
            env: launch.env,
            initialization: launch.initialization,
          }),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
    })

    const clientFor = Effect.fnUntraced(function* (definition: LSPServer.Definition, file: string) {
      const root = yield* Effect.promise(() => definition.root(file, location.directory))
      const key = `${definition.id}\u0000${root}`
      const existing = slots.get(key)
      if (existing) {
        if (existing.broken) return undefined
        return yield* Effect.promise(() => existing.promise).pipe(Effect.catch(() => Effect.succeed(undefined)))
      }
      const created = spawn(definition, root)
      const slot: Slot = { broken: false, promise: undefined as never }
      slot.promise = Effect.runPromise(created).then((client) => {
        if (client === undefined) slot.broken = true
        return client
      })
      slots.set(key, slot)
      return yield* Effect.promise(() => slot.promise).pipe(Effect.catch(() => Effect.succeed(undefined)))
    })

    const sync = Effect.fnUntraced(function* (client: LSPClient.Client, file: string) {
      const after = Date.now()
      const version = yield* Effect.tryPromise({
        try: () => client.open(file),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (version === undefined) return
      yield* Effect.tryPromise({
        try: () => client.waitForDiagnostics(file, version, after, DOCUMENT_DIAGNOSTICS_WAIT_MS),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.void))
    })

    const format = Effect.fnUntraced(function* (client: LSPClient.Client, file: string) {
      if (!client.supportsFormatting()) return false
      const current = yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (current === undefined) return false
      const next = yield* Effect.tryPromise({
        try: () => client.formatting(file, current),
        catch: () => undefined,
      }).pipe(
        Effect.timeoutOption(FORMAT_REQUEST_TIMEOUT_MS),
        Effect.map((option) => (option._tag === "Some" ? option.value : undefined)),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (next === undefined || next === current) return false
      return yield* fs.writeFileString(file, next).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      )
    })

    return Service.of({
      status: () =>
        Effect.sync(() =>
          Array.from(slots.entries()).map(([key, slot]) => {
            const separator = key.indexOf("\u0000")
            return {
              id: key.slice(0, separator),
              root: key.slice(separator + 1),
              status: slot.broken ? ("error" as const) : ("connected" as const),
            }
          }),
        ),
      hasServers: (file) => Effect.sync(() => definitionFor(file) !== undefined),
      fileEdited: (file) =>
        Effect.gen(function* () {
          const definition = definitionFor(file)
          if (definition === undefined) return empty
          const client = yield* clientFor(definition, file)
          if (client === undefined) return empty
          const formatted = yield* format(client, file)
          yield* sync(client, file)
          const block = LSPDiagnostic.report(file, client.diagnostics(file))
          return { formatted, diagnostics: block === "" ? undefined : block }
        }).pipe(Effect.catch(() => Effect.succeed(empty))),
    })
  }),
)

export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    status: () => Effect.succeed([]),
    hasServers: () => Effect.succeed(false),
    fileEdited: () => Effect.succeed(empty),
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, FSUtil.node, Location.node],
})
