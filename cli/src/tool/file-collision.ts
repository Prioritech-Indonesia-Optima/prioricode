import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Project } from "@prioricode/core/project"
import { FSUtil } from "@prioricode/core/fs-util"
import { Context, Effect, Layer, Option } from "effect"
import * as path from "path"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import { FileAttribution } from "./file-attribution"

/**
 * Detects when a file changes on disk between the moment a session last observed
 * it (via read, or its own write) and a later edit/write, so the collision is
 * surfaced in the tool output the model is already looking at.
 *
 * This is deliberately passive: no ambient prompt, no polling. A session working
 * alone never pays for it — `check` returns undefined until it has a recorded
 * fingerprint to compare against.
 *
 * The fingerprint is mtime + size (a single stat, no content read). It is keyed
 * per session so two sessions in the same directory track independent "last
 * seen" states; detection across processes still works because the comparison is
 * against the live on-disk stat, not the in-memory store.
 */

type Fingerprint = { mtimeMs: number; size: number }

export interface Interface {
  /** Record the current on-disk state of a file as the last state this session observed. */
  readonly record: (filepath: string, sessionID: SessionID) => Effect.Effect<void>
  /**
   * Compare the current on-disk state against the last state this session
   * observed. Returns model-facing notice text when the file changed (or was
   * deleted) since then, or undefined when unchanged or never observed.
   */
  readonly check: (filepath: string, sessionID: SessionID, projectID: Project.ID) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/FileCollision") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const attribution = yield* FileAttribution.Service

    const state = yield* InstanceState.make<Map<string, Fingerprint>>(
      Effect.fn("FileCollision.state")(function* () {
        return new Map()
      }),
    )

    const record = Effect.fn("FileCollision.record")(function* (filepath: string, sessionID: SessionID) {
      const store = yield* InstanceState.get(state)
      const key = keyFor(sessionID, filepath)
      const info = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!info || info.type !== "File") {
        store.delete(key)
        return
      }
      store.set(key, fingerprintOf(info))
    })

    // The durable touch ledger names WHO changed the file when a recorded write
    // (a session tool, or the watcher's external record) still matches the live
    // state; when nothing matches, the notice falls back to "no record" wording.
    const check = Effect.fn("FileCollision.check")(function* (
      filepath: string,
      sessionID: SessionID,
      projectID: Project.ID,
    ) {
      const store = yield* InstanceState.get(state)
      const prev = store.get(keyFor(sessionID, filepath))
      if (!prev) return undefined
      const info = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (info && info.type === "File") {
        const next = fingerprintOf(info)
        if (next.mtimeMs === prev.mtimeMs && next.size === prev.size) return undefined
      }
      const kind: "modified" | "deleted" = info && info.type === "File" ? "modified" : "deleted"
      const [owner] = yield* attribution.classify({
        projectID,
        sessionID: String(sessionID),
        base: path.dirname(path.resolve(filepath)),
        paths: [filepath],
      })
      return buildNotice(kind, owner)
    })

    return Service.of({ record, check })
  }),
)

const fingerprintOf = (info: { mtime: Option.Option<Date>; size: unknown }): Fingerprint => ({
  mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
  size: Number(info.size),
})

const keyFor = (sessionID: SessionID, filepath: string) => `${sessionID}\u0000${path.resolve(filepath)}`

function agoLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function buildNotice(kind: "modified" | "deleted", owner: FileAttribution.Attribution | undefined): string {
  const by =
    owner === undefined || owner.status === "unrecorded"
      ? undefined
      : owner.status === "self"
        ? undefined
        : owner.status === "external"
          ? `last recorded as changed outside PrioriCode tools (an editor or shell command) ${agoLabel(Date.now() - owner.touch.timeUpdated)}`
          : `last written by session ${owner.touch.sessionID} (${owner.touch.op}, ${agoLabel(Date.now() - owner.touch.timeUpdated)})`
  if (kind === "deleted") {
    return `This file no longer exists; it was deleted after you last read it${by ? ` — ${by}. Re-read or recreate it before continuing; query the writer via the sessions tool before assuming it is safe to restore` : " — possibly by a peer session or an editor outside PrioriCode. Re-read or recreate it before continuing"}`
  }
  return `This file changed since you last read it${by ? ` — ${by}. Re-read it before relying on the old content; query the writer via the sessions tool before overwriting` : " — possibly by a peer session or an editor outside PrioriCode. Re-read it before relying on the old content; if a sibling session owns the change, query it via the sessions tool before overwriting"}`
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [FSUtil.node, FileAttribution.node],
})

export * as FileCollision from "./file-collision"
