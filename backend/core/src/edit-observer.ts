export * as EditObserver from "./edit-observer"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "./effect/app-node"
import { LSP } from "./lsp/lsp"
import { Snapshot } from "./snapshot"

/**
 * Best-effort observation attached to successful file mutations: language-server
 * formatting plus bounded error diagnostics, and a content-addressed snapshot
 * reference. Every part degrades independently and silently so a mutation never
 * fails because observation infrastructure is unavailable.
 */
export const Result = Schema.Struct({
  formatted: Schema.Boolean.pipe(Schema.optional),
  diagnostics: Schema.String.pipe(Schema.optional),
  snapshot: Schema.String.pipe(Schema.optional),
})
export type Result = typeof Result.Type

export interface Interface {
  readonly afterEdit: (files: ReadonlyArray<string>) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/v2/EditObserver") {}

const empty: Result = {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const snapshots = yield* Snapshot.Service

    const afterEdit = Effect.fn("EditObserver.afterEdit")(function* (files: ReadonlyArray<string>) {
      let formatted = false
      const blocks: string[] = []
      for (const file of files.slice(0, 10)) {
        const edited = yield* lsp.fileEdited(file)
        if (edited.formatted) formatted = true
        if (edited.diagnostics !== undefined) blocks.push(edited.diagnostics)
      }
      const snapshot = yield* snapshots.capture()
      return {
        ...(formatted ? { formatted: true } : {}),
        ...(blocks.length === 0 ? {} : { diagnostics: blocks.join("\n") }),
        ...(snapshot === undefined ? {} : { snapshot }),
      }
    })

    return Service.of({ afterEdit })
  }),
)

export const noopLayer = Layer.succeed(Service, Service.of({ afterEdit: () => Effect.succeed(empty) }))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [LSP.node, Snapshot.node],
})
