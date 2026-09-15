import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/sql"
import { ProjectV2 } from "../project"
import { Timestamps } from "../database/schema.sql"

export type CoordinationKind = "message" | "request" | "response" | "claim"

/**
 * Durable, cross-process coordination between concurrent Sessions that share one
 * project. Every row is readable and writable by any process attached to the
 * shared SQLite database, so separate CLI/server processes can coordinate without
 * an in-memory bus. `to_session` is null for broadcast notes and file claims;
 * `reply_to` threads a response back to its originating request.
 */
export const CoordinationTable = sqliteTable(
  "session_coordination",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    kind: text().$type<CoordinationKind>().notNull(),
    from_session: text().notNull(),
    to_session: text(),
    body: text().notNull(),
    reply_to: text(),
    ...Timestamps,
    time_read: integer(),
  },
  (table) => [
    index("coordination_to_idx").on(table.to_session, table.kind),
    index("coordination_project_idx").on(table.project_id, table.kind),
    index("coordination_reply_idx").on(table.reply_to),
    index("coordination_from_idx").on(table.from_session, table.kind),
  ],
)
