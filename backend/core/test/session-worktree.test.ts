import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@prioricode/effect-drizzle-sqlite"
import { eq, sql } from "drizzle-orm"
import { DatabaseMigration } from "@prioricode/core/database/migration"
import { migrations } from "@prioricode/core/database/migration.gen"
import worktreeMigration from "@prioricode/core/database/migration/20261021183909_add_worktree_isolation_ledgers"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { Database } from "@prioricode/core/database/database"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionSchema } from "@prioricode/core/session/schema"
import { SessionTable } from "@prioricode/core/session/sql"
import { LandClaimTable, SessionWorktreeTable, landClaimId } from "@prioricode/core/session/worktree.sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(Database.node))

const seed = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: SessionSchema.ID.make("ses_isolation_test"),
      project_id: Project.ID.global,
      slug: "iso",
      directory: "/project",
      title: "iso",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  return db
})

describe("worktree isolation ledgers", () => {
  it.effect("binding rows track the session branch lifecycle", () =>
    Effect.gen(function* () {
      const db = yield* seed
      yield* db
        .insert(SessionWorktreeTable)
        .values({
          session_id: SessionSchema.ID.make("ses_isolation_test"),
          project_id: Project.ID.global,
          directory: "/data/worktree/p/iso",
          branch: "prioricode/iso",
          base_sha: "abc123",
          status: "active",
        })
        .run()
        .pipe(Effect.orDie)
      const row = yield* db
        .select()
        .from(SessionWorktreeTable)
        .where(eq(SessionWorktreeTable.session_id, SessionSchema.ID.make("ses_isolation_test")))
        .get()
        .pipe(Effect.orDie)
      expect(row?.status).toBe("active")
      expect(row?.branch).toBe("prioricode/iso")

      yield* db
        .update(SessionWorktreeTable)
        .set({ status: "landed", merge_sha: "def456", time_landed: 999 })
        .where(eq(SessionWorktreeTable.session_id, SessionSchema.ID.make("ses_isolation_test")))
        .run()
        .pipe(Effect.orDie)
      const landed = yield* db
        .select({ status: SessionWorktreeTable.status, merge: SessionWorktreeTable.merge_sha })
        .from(SessionWorktreeTable)
        .where(eq(SessionWorktreeTable.session_id, SessionSchema.ID.make("ses_isolation_test")))
        .get()
        .pipe(Effect.orDie)
      expect(landed).toEqual({ status: "landed", merge: "def456" })
    }),
  )

  it.effect("land claim PK gives exactly one winner per project+branch", () => {
    const claim = (session: string) =>
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const id = landClaimId(Project.ID.global, "prioricode/x")
        const inserted = yield* db
          .insert(LandClaimTable)
          .values({
            id,
            project_id: Project.ID.global,
            branch: "prioricode/x",
            session_id: SessionSchema.ID.make(session),
            status: "reserved",
            base_oid: "aaa",
            deadline: 4242,
          })
          .onConflictDoNothing()
          .returning({ id: LandClaimTable.id })
          .get()
          .pipe(Effect.orDie)
        return inserted?.id
      })
    return Effect.gen(function* () {
      const db = yield* seed
      void db
      const first = yield* claim("ses_isolation_test")
      expect(first).toBe(landClaimId(Project.ID.global, "prioricode/x"))
      const second = yield* claim("ses_other")
      expect(second).toBeUndefined()
    })
  })

  it.effect("deleting the session cascades the binding", () =>
    Effect.gen(function* () {
      const db = yield* seed
      yield* db
        .insert(SessionWorktreeTable)
        .values({
          session_id: SessionSchema.ID.make("ses_isolation_test"),
          project_id: Project.ID.global,
          directory: "/data/worktree/p/cascade",
          branch: "prioricode/cascade",
          base_sha: "x",
          status: "active",
        })
        .run()
        .pipe(Effect.orDie)
      yield* db.delete(SessionTable).where(eq(SessionTable.id, SessionSchema.ID.make("ses_isolation_test"))).run().pipe(Effect.orDie)
      const left = yield* db
        .select({ id: SessionWorktreeTable.session_id })
        .from(SessionWorktreeTable)
        .where(eq(SessionWorktreeTable.session_id, SessionSchema.ID.make("ses_isolation_test")))
        .get()
        .pipe(Effect.orDie)
      expect(left).toBeUndefined()
    }),
  )
})

describe("worktree migration idempotency", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, import("effect/unstable/sql/SqlClient").SqlClient>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
    )
  const makeDb = EffectDrizzleSqlite.makeWithDefaults()

  // The fresh path replays the full ordered migration list; re-applying the
  // worktree migration on top simulates the cross-process race where two
  // servers both run it against one file. Everything must be a no-op.
  test("second apply of the worktree migration succeeds", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.applyOnly(db, migrations)
        yield* DatabaseMigration.applyOnly(db, [worktreeMigration])
        const tables = yield* db.all<{ name: string }>(
          sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('land_claim','session_worktree')`,
        )
        expect(tables.map((table) => table.name).sort()).toEqual(["land_claim", "session_worktree"])
        const columns = yield* db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('session_file_touch')`)
        expect(columns.some((column) => column.name === "relative_path")).toBe(true)
      }),
    )
  })
})
