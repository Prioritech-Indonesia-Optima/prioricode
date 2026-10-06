import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { ProjectV2 } from "../project"
import { ProjectTable } from "../project/sql"

export type PresenceState = "busy" | "idle"

/**
 * Durable, cross-process busy/idle presence for Sessions that share one project.
 * The in-memory SessionStatus map is per-process, so a session busy in another
 * process looks idle here. This table is the shared truth: the owning process
 * upserts `state` on every transition and bumps `time_heartbeat` while busy, so
 * a crashed process's `busy` row goes stale and is (correctly) treated as idle
 * after a grace window. Keyed by session; one row per session.
 */
export const SessionPresenceTable = sqliteTable("session_presence", {
  session_id: text().primaryKey(),
  project_id: text()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  state: text().$type<PresenceState>().notNull(),
  time_changed: integer().notNull(),
  pid: integer(),
  time_heartbeat: integer().notNull(),
})
