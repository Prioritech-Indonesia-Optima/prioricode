import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Effect, Layer, Context } from "effect"
import { inArray } from "drizzle-orm"
import { Database } from "@prioricode/core/database/database"
import { SessionPresenceTable, type PresenceState } from "@prioricode/core/session/presence.sql"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"

export type { PresenceState }

/**
 * A `busy` presence row whose heartbeat is older than this is treated as idle:
 * the owning process died without an `onIdle`, so the session is not actually
 * running. Generous enough to survive a single slow model step (the owning
 * process bumps the heartbeat every watcher tick while it is genuinely busy).
 */
export const DEAD_PROCESS_GRACE_MS = 3 * 60_000

export interface Interface {
  /** Upsert a session's durable busy/idle state (called from every status transition). */
  readonly set: (sessionID: SessionID, state: PresenceState) => Effect.Effect<void>
  /** Bump the heartbeat for the given (locally-busy) sessions so they read as alive. */
  readonly touch: (sessionIDs: ReadonlyArray<SessionID>) => Effect.Effect<void>
  /**
   * For each of `sessionIDs` that is DURABLY idle across processes, its idle-since
   * timestamp. A session is durably idle when it has no presence row (never ran →
   * since 0), an `idle` row (since = time_changed), or a `busy` row with a stale
   * (crashed-owner) heartbeat (since = last heartbeat). Sessions that are
   * genuinely busy-alive are absent from the map.
   */
  readonly idleSince: (sessionIDs: ReadonlyArray<SessionID>) => Effect.Effect<Map<SessionID, number>>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/SessionPresence") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const set = Effect.fn("SessionPresence.set")(function* (sessionID: SessionID, state: PresenceState) {
      const ctx = yield* InstanceState.context
      const now = Date.now()
      yield* db
        .insert(SessionPresenceTable)
        .values({
          session_id: sessionID,
          project_id: ctx.project.id,
          state,
          time_changed: now,
          pid: process.pid,
          time_heartbeat: now,
        })
        .onConflictDoUpdate({
          target: SessionPresenceTable.session_id,
          set: { state, time_changed: now, time_heartbeat: now, pid: process.pid },
        })
        .run()
        .pipe(Effect.orDie)
    })

    const touch = Effect.fn("SessionPresence.touch")(function* (sessionIDs: ReadonlyArray<SessionID>) {
      if (sessionIDs.length === 0) return
      yield* db
        .update(SessionPresenceTable)
        .set({ time_heartbeat: Date.now() })
        .where(inArray(SessionPresenceTable.session_id, [...sessionIDs]))
        .run()
        .pipe(Effect.orDie)
    })

    const idleSince = Effect.fn("SessionPresence.idleSince")(function* (
      sessionIDs: ReadonlyArray<SessionID>,
    ) {
      const result = new Map<SessionID, number>()
      // No presence row = never ran = idle since the epoch.
      for (const id of sessionIDs) result.set(id, 0)
      if (sessionIDs.length === 0) return result
      const now = Date.now()
      const rows = (yield* db
        .select()
        .from(SessionPresenceTable)
        .where(inArray(SessionPresenceTable.session_id, [...sessionIDs]))
        .all()
        .pipe(Effect.orDie)) as (typeof SessionPresenceTable.$inferSelect)[]
      for (const row of rows) {
        const id = row.session_id as SessionID
        if (row.state === "idle") {
          result.set(id, row.time_changed)
          continue
        }
        // busy row: idle only if the owner's heartbeat went stale (crashed process).
        if (row.time_heartbeat < now - DEAD_PROCESS_GRACE_MS) {
          result.set(id, row.time_heartbeat)
        } else {
          result.delete(id)
        }
      }
      return result
    })

    return Service.of({ set, touch, idleSince })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Database.node] })

export * as SessionPresence from "./presence"
