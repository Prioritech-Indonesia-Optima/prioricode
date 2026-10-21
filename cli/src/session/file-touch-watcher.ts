import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Context, Effect, Layer, Option } from "effect"
import * as path from "path"
import { InstanceState } from "@/effect/instance-state"
import { EventBridge } from "@/event-v2-bridge"
import { FileTouch } from "@prioricode/core/file-touch"
import { FSUtil } from "@prioricode/core/fs-util"
import { Watcher } from "@prioricode/core/filesystem/watcher"
import { EventBus } from "@prioricode/core/event"

/**
 * Attributes out-of-band file changes — the user's editor, a shell command, any
 * process outside PrioriCode's own tools — to the durable touch ledger as
 * `external` / `external-delete`. This is what lets a session tell "a sibling
 * session wrote this" apart from "no PrioriCode tool wrote this, so the user or
 * their tools did".
 *
 * Deliberately passive: it only reacts to `file.watcher.updated` events (the
 * same stream tools publish themselves), never polls, and a solo session pays at
 * most one ledger row per externally changed file. The stored fingerprint is
 * compared against the live stat before recording, so the echo of a tool write
 * is dropped and a session's own recorded write is never clobbered.
 */
export interface Interface {
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/FileTouchWatcher") {}

type State = { readonly watching: true }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventBridge.Service
    const fs = yield* FSUtil.Service
    const touches = yield* FileTouch.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("FileTouchWatcher.state")(function* (ctx) {
        const track = Effect.fnUntraced(function* (file: string, kind: string) {
          if (!path.isAbsolute(file)) return
          if (!FSUtil.contains(ctx.worktree, file)) return
          if (path.relative(ctx.worktree, file).split(path.sep).includes(".git")) return
          const info =
            kind === "unlink" ? undefined : yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info !== undefined && info.type !== "File") return
          const [row] = yield* touches.lookup({ projectID: ctx.project.id, paths: [file] })
          if (info === undefined) {
            // A deletion nobody recorded is only attribution-worthy when the
            // ledger knew the file; untracked churn (temp files, build cleanup)
            // stays invisible on purpose.
            if (row === undefined || (row.fingerprint.mtimeMs === 0 && row.fingerprint.size === 0)) return
            yield* touches.record({
              projectID: ctx.project.id,
              path: file,
              relativePath: FileTouch.relativePath(ctx.worktree, file),
              op: "external-delete",
              fingerprint: { mtimeMs: 0, size: 0 },
            })
            return
          }
          const fingerprint = {
            mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
            size: Number(info.size),
          }
          // The live state matches the stored fingerprint: this event is the echo
          // of a recorded tool write (or a duplicate watcher delivery), not a new
          // author.
          if (row && row.fingerprint.mtimeMs === fingerprint.mtimeMs && row.fingerprint.size === fingerprint.size)
            return
          yield* touches.record({
            projectID: ctx.project.id,
            path: file,
            relativePath: FileTouch.relativePath(ctx.worktree, file),
            op: "external",
            fingerprint,
          })
        })

        const unsubscribe = yield* events.listen((event) => {
          if (event.type !== Watcher.Event.Updated.type || event.location?.directory !== ctx.directory)
            return Effect.void
          const data = event.data as EventBus.Data<typeof Watcher.Event.Updated>
          return track(data.file, data.event)
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        return { watching: true as const }
      }),
    )

    return Service.of({
      // Materialize synchronously: the subscription lives in the per-instance
      // scope from here on, and tests get deterministic delivery.
      init: Effect.fn("FileTouchWatcher.init")(function* () {
        yield* InstanceState.get(state)
      }),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventBridge.node, FSUtil.node, FileTouch.node],
})

export * as FileTouchWatcher from "./file-touch-watcher"
