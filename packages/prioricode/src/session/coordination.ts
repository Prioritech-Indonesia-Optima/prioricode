import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Effect, Layer, Context } from "effect"
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"
import { Database } from "@prioricode/core/database/database"
import { CoordinationTable, type CoordinationKind } from "@prioricode/core/session/coordination.sql"
import { Identifier } from "@prioricode/core/id/id"
import { ProjectV2 } from "@prioricode/core/project"
import { SessionID } from "./schema"

export type { CoordinationKind }

export interface Info {
  readonly id: string
  readonly projectID: ProjectV2.ID
  readonly kind: CoordinationKind
  readonly fromSession: SessionID
  readonly toSession?: SessionID
  readonly body: string
  readonly replyTo?: string
  readonly timeCreated: number
  readonly timeRead?: number
}

export interface PostInput {
  readonly id?: string
  readonly projectID: ProjectV2.ID
  readonly kind: CoordinationKind
  readonly fromSession: SessionID
  readonly toSession?: SessionID
  readonly body: string
  readonly replyTo?: string
}

export interface InboxInput {
  readonly sessionID: SessionID
  readonly kinds?: ReadonlyArray<CoordinationKind>
  readonly unreadOnly?: boolean
}

export interface Interface {
  readonly post: (input: PostInput) => Effect.Effect<Info>
  readonly inbox: (input: InboxInput) => Effect.Effect<Info[]>
  readonly markRead: (ids: ReadonlyArray<string>) => Effect.Effect<void>
  readonly responsesTo: (requestID: string) => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly claims: (input: { projectID: ProjectV2.ID; exceptSession?: SessionID }) => Effect.Effect<Info[]>
  readonly myClaims: (sessionID: SessionID) => Effect.Effect<Info[]>
  readonly releaseClaims: (input: { sessionID: SessionID; paths: ReadonlyArray<string> }) => Effect.Effect<void>
  readonly clearClaims: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/SessionCoordination") {}

const fromRow = (row: typeof CoordinationTable.$inferSelect): Info => ({
  id: row.id,
  projectID: row.project_id,
  kind: row.kind,
  fromSession: row.from_session as SessionID,
  ...(row.to_session ? { toSession: row.to_session as SessionID } : {}),
  body: row.body,
  ...(row.reply_to ? { replyTo: row.reply_to } : {}),
  timeCreated: row.time_created,
  ...(row.time_read === null ? {} : { timeRead: row.time_read }),
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const post = Effect.fn("Coordination.post")(function* (input: PostInput) {
      const id = input.id ?? Identifier.ascending("coordination")
      const now = Date.now()
      yield* db
        .insert(CoordinationTable)
        .values({
          id,
          project_id: input.projectID,
          kind: input.kind,
          from_session: input.fromSession,
          to_session: input.toSession ?? null,
          body: input.body,
          reply_to: input.replyTo ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)
      return {
        id,
        projectID: input.projectID,
        kind: input.kind,
        fromSession: input.fromSession,
        ...(input.toSession ? { toSession: input.toSession } : {}),
        body: input.body,
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        timeCreated: now,
      }
    })

    const inbox = Effect.fn("Coordination.inbox")(function* (input: InboxInput) {
      const conditions = [eq(CoordinationTable.to_session, input.sessionID)]
      if (input.kinds && input.kinds.length > 0) conditions.push(inArray(CoordinationTable.kind, input.kinds))
      if (input.unreadOnly) conditions.push(isNull(CoordinationTable.time_read))
      const rows = yield* db
        .select()
        .from(CoordinationTable)
        .where(and(...conditions))
        .orderBy(asc(CoordinationTable.time_created))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const markRead = Effect.fn("Coordination.markRead")(function* (ids: ReadonlyArray<string>) {
      if (ids.length === 0) return
      yield* db
        .update(CoordinationTable)
        .set({ time_read: Date.now(), time_updated: Date.now() })
        .where(and(inArray(CoordinationTable.id, ids), isNull(CoordinationTable.time_read)))
        .run()
        .pipe(Effect.orDie)
    })

    const responsesTo = Effect.fn("Coordination.responsesTo")(function* (requestID: string) {
      const rows = yield* db
        .select()
        .from(CoordinationTable)
        .where(and(eq(CoordinationTable.kind, "response"), eq(CoordinationTable.reply_to, requestID)))
        .orderBy(asc(CoordinationTable.time_created))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const get = Effect.fn("Coordination.get")(function* (id: string) {
      const row = yield* db.select().from(CoordinationTable).where(eq(CoordinationTable.id, id)).get().pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    const claims = Effect.fn("Coordination.claims")(function* (input: {
      projectID: ProjectV2.ID
      exceptSession?: SessionID
    }) {
      const rows = yield* db
        .select()
        .from(CoordinationTable)
        .where(and(eq(CoordinationTable.kind, "claim"), eq(CoordinationTable.project_id, input.projectID)))
        .orderBy(desc(CoordinationTable.time_created))
        .all()
        .pipe(Effect.orDie)
      const all = rows.map(fromRow)
      return input.exceptSession ? all.filter((row) => row.fromSession !== input.exceptSession) : all
    })

    const myClaims = Effect.fn("Coordination.myClaims")(function* (sessionID: SessionID) {
      const rows = yield* db
        .select()
        .from(CoordinationTable)
        .where(and(eq(CoordinationTable.kind, "claim"), eq(CoordinationTable.from_session, sessionID)))
        .orderBy(desc(CoordinationTable.time_created))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const releaseClaims = Effect.fn("Coordination.releaseClaims")(function* (input: {
      sessionID: SessionID
      paths: ReadonlyArray<string>
    }) {
      if (input.paths.length === 0) return
      yield* db
        .delete(CoordinationTable)
        .where(
          and(
            eq(CoordinationTable.kind, "claim"),
            eq(CoordinationTable.from_session, input.sessionID),
            inArray(CoordinationTable.body, [...input.paths]),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    })

    const clearClaims = Effect.fn("Coordination.clearClaims")(function* (sessionID: SessionID) {
      yield* db
        .delete(CoordinationTable)
        .where(and(eq(CoordinationTable.kind, "claim"), eq(CoordinationTable.from_session, sessionID)))
        .run()
        .pipe(Effect.orDie)
    })

    return Service.of({ post, inbox, markRead, responsesTo, get, claims, myClaims, releaseClaims, clearClaims })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node] })

export * as Coordination from "./coordination"
