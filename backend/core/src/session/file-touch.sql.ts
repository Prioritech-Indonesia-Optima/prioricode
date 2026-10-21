import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/sql"
import { Project } from "../project"
import { Timestamps } from "../database/schema.sql"

/**
 * What happened to the file in the recorded write. `external` / `external-delete`
 * come from the filesystem watcher: a change no session's tool authored (user
 * editor, shell command, other process).
 */
export type FileTouchOp = "create" | "modify" | "delete" | "external" | "external-delete"

/**
 * Durable file-touch attribution between concurrent Sessions that share one
 * project. One row per (project, absolute path): the last writer — a session id,
 * or null for an out-of-band change — with the op, the mtime+size fingerprint of
 * the write, and provenance pointers (message/call/model) into the message
 * ledger where the full diff of that write is persisted as tool-part metadata.
 *
 * This is fact, not intent: claims say a session means to work on a path, this
 * says who last actually wrote it. The fingerprint is what makes the row
 * falsifiable — a surface only claims "last written by X" while the stored
 * fingerprint still matches the live file; once it drifts, attribution has no
 * record. Lines are deliberately not stored: line numbers rot (formatter, peer
 * reflow) and the exact hunk already lives in the durable tool-part diff this
 * row indexes.
 */
export const FileTouchTable = sqliteTable(
  "session_file_touch",
  {
    project_id: text()
      .$type<Project.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    path: text().notNull(),
    /**
     * Path relative to the project's PRIMARY worktree, when the absolute path
     * lives under it. Two sessions in two isolated worktrees of one repo write
     * different absolute paths for the same repo file; `relative_path` is what
     * lets land-time conflict intelligence answer "who touched this repo path
     * anywhere" instead of missing a sibling worktree's touch by exact-path key.
     * NULL means "outside the primary tree" — exact-match-only, never a guess.
     */
    relative_path: text(),
    from_session: text(),
    op: text().$type<FileTouchOp>().notNull(),
    mtime_ms: integer().notNull(),
    size: integer().notNull(),
    message_id: text(),
    call_id: text(),
    model: text(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.project_id, table.path] }),
    index("file_touch_project_session_idx").on(table.project_id, table.from_session),
    index("file_touch_project_time_idx").on(table.project_id, table.time_updated),
    index("file_touch_project_relative_idx").on(table.project_id, table.relative_path),
  ],
)
