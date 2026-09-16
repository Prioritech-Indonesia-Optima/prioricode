import { LayerNode } from "@prioricode/core/effect/layer-node"
import { ProjectV2 } from "@prioricode/core/project"
import { FSUtil } from "@prioricode/core/fs-util"
import { Context, Effect, Layer, Option } from "effect"
import * as path from "path"
import { InstanceState } from "@/effect/instance-state"
import { Coordination } from "@/session/coordination"
import { SessionID } from "@/session/schema"

/**
 * Detects when a file changes on disk between the moment a session last observed
 * it (via read, or its own write) and a later edit/write, so the collision is
 * surfaced in the tool output the model is already looking at.
 *
 * This is deliberately passive: no ambient prompt, no polling. A session working
 * alone never pays for it — `check` returns undefined until it has a recorded
 * fingerprint to compare against, and the peer-claim lookup only runs when a
 * change is actually detected.
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
  readonly check: (
    filepath: string,
    sessionID: SessionID,
    projectID: ProjectV2.ID,
  ) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/FileCollision") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const coordination = yield* Coordination.Service

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

    const check = Effect.fn("FileCollision.check")(function* (
      filepath: string,
      sessionID: SessionID,
      projectID: ProjectV2.ID,
    ) {
      const store = yield* InstanceState.get(state)
      const prev = store.get(keyFor(sessionID, filepath))
      if (!prev) return undefined
      const info = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!info || info.type !== "File") {
        return buildNotice("deleted", yield* claimers(projectID, sessionID, filepath))
      }
      const next = fingerprintOf(info)
      if (next.mtimeMs === prev.mtimeMs && next.size === prev.size) return undefined
      return buildNotice("modified", yield* claimers(projectID, sessionID, filepath))
    })

    const claimers = Effect.fn("FileCollision.claimers")(function* (
      projectID: ProjectV2.ID,
      sessionID: SessionID,
      filepath: string,
    ) {
      const ctx = yield* InstanceState.context
      const claims = yield* coordination.claims({ projectID, exceptSession: sessionID })
      const rel = path.relative(ctx.worktree, filepath)
      const seen = new Set<SessionID>()
      const out: SessionID[] = []
      for (const claim of claims) {
        if (!claimMatches(claim.body, filepath, rel)) continue
        if (!seen.has(claim.fromSession)) {
          seen.add(claim.fromSession)
          out.push(claim.fromSession)
        }
      }
      return out
    })

    return Service.of({ record, check })
  }),
)

const fingerprintOf = (info: { mtime: Option.Option<Date>; size: unknown }): Fingerprint => ({
  mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
  size: Number(info.size),
})

const keyFor = (sessionID: SessionID, filepath: string) => `${sessionID}\u0000${path.resolve(filepath)}`

function claimMatches(body: string, filepath: string, rel: string): boolean {
  if (body === filepath || body === rel) return true
  if (!path.isAbsolute(body) && path.resolve(path.dirname(filepath), body) === filepath) return true
  return false
}

function buildNotice(kind: "modified" | "deleted", claimers: SessionID[]): string {
  const who =
    claimers.length > 0 ? ` Another PrioriCode session (${claimers.join(", ")}) has this file claimed.` : ""
  if (kind === "deleted") {
    return `This file no longer exists; it was deleted after you last read it.${who} Re-read or recreate it before continuing.`
  }
  return `This file changed since you last read it.${who} Re-read it before relying on the old content.`
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [FSUtil.node, Coordination.node],
})

export * as FileCollision from "./file-collision"
