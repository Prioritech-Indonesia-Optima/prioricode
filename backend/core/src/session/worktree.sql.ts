import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { ProjectTable } from "../project/sql"
import { Project } from "../project"
import { SessionTable } from "./sql"
import type { SessionSchema } from "./schema"
import { Timestamps } from "../database/schema.sql"

/**
 * Session ↔ branch ↔ managed-worktree binding: the ledger of the
 * branch-per-session discipline. One row per root session that owns an
 * isolated branch; the worktree directory is plumbing, the branch is the
 * product. Rows are created by SessionIsolation at provisioning time and
 * progressed by `land` (active → landing → landed) and GC (→ discarded).
 *
 * Status is forward-only like the coordination stamps: booting → active →
 * landing → landed | discarded. A crash mid-landing is recovered by GC via the
 * land_claim deadline, never by rewriting a landed row back.
 */
export type SessionWorktreeStatus = "booting" | "active" | "landing" | "landed" | "discarded"

export const SessionWorktreeTable = sqliteTable(
  "session_worktree",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    project_id: text()
      .$type<Project.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    branch: text().notNull(),
    base_sha: text().notNull(),
    status: text().$type<SessionWorktreeStatus>().notNull(),
    merge_sha: text(),
    time_landed: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("session_worktree_project_directory_idx").on(table.project_id, table.directory),
    index("session_worktree_project_status_idx").on(table.project_id, table.status),
  ],
)

/**
 * Land-claim mutual exclusion across processes: winning the deterministic
 * primary key (`land:<projectID>:<branch>`) is the right to move `main`.
 * Crash-window rows expire past their deadline so an abandoned claim cannot
 * wedge a repo; expiry is a GC decision, never an override.
 */
export type LandClaimStatus = "reserved" | "merged" | "blocked" | "landed" | "abandoned"

export const LandClaimTable = sqliteTable("land_claim", {
  id: text().primaryKey(),
  project_id: text()
    .$type<Project.ID>()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  branch: text().notNull(),
  session_id: text().$type<SessionSchema.ID>().notNull(),
  status: text().$type<LandClaimStatus>().notNull(),
  base_oid: text().notNull(),
  green_tree_oid: text(),
  merge_oid: text(),
  deadline: integer().notNull(),
  ...Timestamps,
})

export const landClaimId = (projectID: Project.ID, branch: string) => `land:${projectID}:${branch}`
