import { Context, Effect, Layer, Option } from "effect"
import * as path from "path"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { FileTouch } from "@prioricode/core/file-touch"
import { FSUtil } from "@prioricode/core/fs-util"
import { Project } from "@prioricode/core/project"

/**
 * Shared file-attribution classification for every model-facing surface
 * (collision notice, attribution query, shell git advisory). A touch row is
 * only a claim about the CURRENT file state while its stored fingerprint still
 * matches the live stat; once it drifts, no ledgered write produced what is on
 * disk now — surfaced as `unrecorded` (with the stale row attached as context)
 * rather than a confidently wrong owner.
 */
export type Attribution =
  | { readonly path: string; readonly status: "self" | "peer" | "external"; readonly touch: FileTouch.Touch }
  | { readonly path: string; readonly status: "unrecorded"; readonly staleTouch?: FileTouch.Touch }

export interface ClassifyInput {
  readonly projectID: Project.ID
  readonly sessionID: string
  readonly base: string
  readonly paths: ReadonlyArray<string>
}

export interface Interface {
  /** Classify exact paths. Relative entries resolve against `base` (the worktree). */
  readonly classify: (input: ClassifyInput) => Effect.Effect<Attribution[]>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/FileAttribution") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const touches = yield* FileTouch.Service

    const liveFingerprint = Effect.fnUntraced(function* (filepath: string) {
      const info = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (info === undefined || info.type !== "File") return undefined
      return {
        mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
        size: Number(info.size),
      }
    })

    const classifyOne = Effect.fnUntraced(function* (projectID: Project.ID, sessionID: string, filepath: string) {
      const [row] = yield* touches.lookup({ projectID, paths: [filepath] })
      if (row === undefined) return { path: filepath, status: "unrecorded" as const }
      const live = yield* liveFingerprint(filepath)
      // Present file: fingerprint must match. Gone file: a {0,0} row is a
      // recorded deletion and remains authoritative.
      const matches =
        live !== undefined
          ? row.fingerprint.mtimeMs === live.mtimeMs && row.fingerprint.size === live.size
          : row.fingerprint.mtimeMs === 0 && row.fingerprint.size === 0
      if (!matches) return { path: filepath, status: "unrecorded" as const, staleTouch: row }
      if (row.sessionID === undefined) return { path: filepath, status: "external" as const, touch: row }
      return { path: filepath, status: row.sessionID === sessionID ? ("self" as const) : ("peer" as const), touch: row }
    })

    return Service.of({
      classify: Effect.fn("FileAttribution.classify")(function* (input: ClassifyInput) {
        return yield* Effect.forEach(
          input.paths.map((item) => (path.isAbsolute(item) ? path.resolve(item) : path.resolve(input.base, item))),
          (filepath) => classifyOne(input.projectID, input.sessionID, filepath),
          { concurrency: 8 },
        )
      }),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node, FileTouch.node] })

export * as FileAttribution from "./file-attribution"
