import path from "path"
import { Context, Effect, Layer } from "effect"
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { Flag } from "./flag/flag"
import { Project } from "./project"
import { FileTouchTable, type FileTouchOp } from "./session/file-touch.sql"

export type { FileTouchOp }

export interface Fingerprint {
  readonly mtimeMs: number
  readonly size: number
}

/** Pointers into the message ledger where the write's full diff is persisted. */
export interface Provenance {
  readonly messageID?: string
  readonly callID?: string
  readonly model?: string
}

export interface Touch {
  readonly projectID: Project.ID
  readonly path: string
  readonly relativePath?: string
  /** The session that authored the write; undefined for an out-of-band change. */
  readonly sessionID?: string
  readonly op: FileTouchOp
  readonly fingerprint: Fingerprint
  readonly provenance?: Provenance
  readonly timeCreated: number
  readonly timeUpdated: number
}

export interface RecordInput {
  readonly projectID: Project.ID
  readonly path: string
  /**
   * Repo-relative form of `path`, computed by the WRITER against its own
   * checkout root (worktrees of one repo share repo paths, not filesystem
   * roots). Undefined when the path escapes any repo (foreign scratch file).
   */
  readonly relativePath?: string
  readonly op: FileTouchOp
  readonly fingerprint: Fingerprint
  /** Omitted for watcher-recorded external changes. */
  readonly sessionID?: string
  readonly provenance?: Provenance
}

export interface Interface {
  /**
   * Upsert the last-writer row for one path. Best-effort by contract: a ledger
   * failure is swallowed so the file mutation it documents never fails because
   * attribution is unavailable (same philosophy as EditObserver).
   */
  readonly record: (input: RecordInput) => Effect.Effect<void>
  /** Latest-touch rows for exact paths, one per path that has a row. */
  readonly lookup: (input: { projectID: Project.ID; paths: ReadonlyArray<string> }) => Effect.Effect<Touch[]>
  /**
   * Recent touches newest-first, optionally restricted to a session set, capped.
   * Roster rendering must use this bounded form, never a raw table scan.
   */
  readonly recent: (input: {
    projectID: Project.ID
    sessionIDs?: ReadonlyArray<string>
    withinMs: number
    limit: number
  }) => Effect.Effect<Touch[]>
  /**
   * Latest touches by repo-relative path across ALL worktrees of the project —
   * the cross-session collision query land uses. Newest-first, capped.
   */
  readonly lookupRelative: (input: {
    projectID: Project.ID
    paths: ReadonlyArray<string>
    excludeSessionID?: string
    limit?: number
  }) => Effect.Effect<Touch[]>
}

/**
 * Repo-relative form of an absolute path against a checkout root; undefined
 * when the path escapes the root (foreign scratch files store NULL). Writers
 * compute this against their OWN checkout — worktrees share repo paths, not
 * filesystem roots.
 */
export const relativePath = (root: string, filepath: string): string | undefined => {
  const rel = path.relative(path.resolve(root), path.resolve(filepath))
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return undefined
  return rel.replaceAll("\\", "/")
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/FileTouch") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const record = Effect.fn("FileTouch.record")(function* (input: RecordInput) {
      if (Flag.PRIORICODE_DISABLE_FILE_TOUCH) return
      const row = {
        project_id: input.projectID,
        path: input.path,
        relative_path: input.relativePath ?? null,
        from_session: input.sessionID ?? null,
        op: input.op,
        mtime_ms: input.fingerprint.mtimeMs,
        size: input.fingerprint.size,
        message_id: input.provenance?.messageID ?? null,
        call_id: input.provenance?.callID ?? null,
        model: input.provenance?.model ?? null,
      }
      yield* db
        .insert(FileTouchTable)
        .values({ ...row, time_created: Date.now(), time_updated: Date.now() })
        .onConflictDoUpdate({
          target: [FileTouchTable.project_id, FileTouchTable.path],
          set: { ...row, time_updated: Date.now() },
        })
        .run()
        .pipe(Effect.catch(() => Effect.void))
    })

    const fromRow = (row: typeof FileTouchTable.$inferSelect): Touch => ({
      projectID: row.project_id,
      path: row.path,
      ...(row.relative_path === null ? {} : { relativePath: row.relative_path }),
      ...(row.from_session === null ? {} : { sessionID: row.from_session }),
      op: row.op,
      fingerprint: { mtimeMs: row.mtime_ms, size: row.size },
      ...(row.message_id || row.call_id || row.model
        ? {
            provenance: {
              ...(row.message_id ? { messageID: row.message_id } : {}),
              ...(row.call_id ? { callID: row.call_id } : {}),
              ...(row.model ? { model: row.model } : {}),
            },
          }
        : {}),
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    })

    const lookup = Effect.fn("FileTouch.lookup")(function* (input: {
      projectID: Project.ID
      paths: ReadonlyArray<string>
    }) {
      if (input.paths.length === 0) return []
      const rows = yield* db
        .select()
        .from(FileTouchTable)
        .where(and(eq(FileTouchTable.project_id, input.projectID), inArray(FileTouchTable.path, input.paths)))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const recent = Effect.fn("FileTouch.recent")(function* (input: {
      projectID: Project.ID
      sessionIDs?: ReadonlyArray<string>
      withinMs: number
      limit: number
    }) {
      const cutoff = Date.now() - input.withinMs
      const rows = yield* db
        .select()
        .from(FileTouchTable)
        .where(
          and(
            eq(FileTouchTable.project_id, input.projectID),
            gte(FileTouchTable.time_updated, cutoff),
            ...(input.sessionIDs && input.sessionIDs.length > 0
              ? [inArray(FileTouchTable.from_session, input.sessionIDs)]
              : []),
          ),
        )
        .orderBy(desc(FileTouchTable.time_updated))
        .limit(input.limit)
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const lookupRelative = Effect.fn("FileTouch.lookupRelative")(function* (input: {
      projectID: Project.ID
      paths: ReadonlyArray<string>
      excludeSessionID?: string
      limit?: number
    }) {
      if (input.paths.length === 0) return []
      const rows = yield* db
        .select()
        .from(FileTouchTable)
        .where(
          and(
            eq(FileTouchTable.project_id, input.projectID),
            inArray(FileTouchTable.relative_path, input.paths),
            ...(input.excludeSessionID === undefined ? [] : [sql`${FileTouchTable.from_session} IS NOT ${input.excludeSessionID}`]),
          ),
        )
        .orderBy(desc(FileTouchTable.time_updated))
        .limit(input.limit ?? 100)
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    return Service.of({ record, lookup, recent, lookupRelative })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

export * as FileTouch from "./file-touch"
