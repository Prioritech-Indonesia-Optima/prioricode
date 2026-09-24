import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@prioricode/core/database/database"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { SessionPresenceTable } from "@prioricode/core/session/presence.sql"
import { SessionV2 } from "@prioricode/core/session"
import { SessionPresence, DEAD_PROCESS_GRACE_MS } from "@/session/presence"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Database.node, SessionPresence.node])))

const a = SessionV2.ID.make("ses_pres_a")
const b = SessionV2.ID.make("ses_pres_b")

describe("SessionPresence", () => {
  it.instance("idleSince: no row reads as idle since 0", () =>
    Effect.gen(function* () {
      const presence = yield* SessionPresence.Service
      const result = yield* presence.idleSince([a, b])
      expect(result.get(a)).toBe(0)
      expect(result.get(b)).toBe(0)
    }),
  )

  it.instance("set busy excludes a session; set idle re-includes it with the change time", () =>
    Effect.gen(function* () {
      const presence = yield* SessionPresence.Service
      yield* presence.set(a, "busy")
      expect((yield* presence.idleSince([a])).has(a)).toBe(false)
      yield* presence.set(a, "idle")
      const since = (yield* presence.idleSince([a])).get(a)
      expect(since).toBeNumber()
      expect(since!).toBeGreaterThan(0)
    }),
  )

  it.instance("a busy row with a stale heartbeat reads as idle (crashed owner)", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const presence = yield* SessionPresence.Service
      yield* presence.set(a, "busy")
      // Simulate the owning process dying: backdate the heartbeat past the grace.
      const stale = Date.now() - DEAD_PROCESS_GRACE_MS - 1000
      yield* db
        .update(SessionPresenceTable)
        .set({ time_heartbeat: stale })
        .where(eq(SessionPresenceTable.session_id, a))
        .run()
        .pipe(Effect.orDie)
      const result = yield* presence.idleSince([a])
      expect(result.get(a)).toBe(stale)
    }),
  )

  it.instance("touch bumps the heartbeat for busy sessions", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const presence = yield* SessionPresence.Service
      yield* presence.set(a, "busy")
      const before = (yield* db
        .select()
        .from(SessionPresenceTable)
        .where(eq(SessionPresenceTable.session_id, a))
        .get()
        .pipe(Effect.orDie))!
      yield* Effect.sleep("5 millis")
      yield* db
        .update(SessionPresenceTable)
        .set({ time_heartbeat: before.time_heartbeat - 1000 })
        .where(eq(SessionPresenceTable.session_id, a))
        .run()
        .pipe(Effect.orDie)
      yield* presence.touch([a])
      const after = (yield* db
        .select()
        .from(SessionPresenceTable)
        .where(eq(SessionPresenceTable.session_id, a))
        .get()
        .pipe(Effect.orDie))!
      expect(after.time_heartbeat).toBeGreaterThan(before.time_heartbeat - 1000)
    }),
  )
})
