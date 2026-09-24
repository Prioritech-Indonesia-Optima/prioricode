import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { ProjectTable } from "../project/sql"
import { ProjectV2 } from "../project"
import { Timestamps } from "../database/schema.sql"

export type CoordinationKind = "message" | "request" | "response" | "claim" | "record" | "notify"

/**
 * Durable, cross-process coordination between concurrent Sessions that share one
 * project. Every row is readable and writable by any process attached to the
 * shared SQLite database, so separate CLI/server processes can coordinate without
 * an in-memory bus. `to_session` is null for broadcast notes and file claims;
 * `reply_to` threads a response back to its originating request.
 *
 * Delivery ledger (message/request/response/record rows): `time_read` is stamped
 * atomically when a row is claimed for injection into a model context,
 * `claimed_by` records the token of that claim (the injecting assistant message
 * id, or a generated watcher token), and `time_ack` is stamped once the model
 * step that carried the injected content completed without error. A row that is
 * read but never acked (crash, compaction, provider failure) is unclaimed by the
 * coordination watcher and re-delivered.
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
    time_ack: integer(),
    claimed_by: text(),
    deadline: integer(),
    time_escalated: integer(),
    time_expired: integer(),
    thread_id: text(),
  },
  (table) => [
    index("coordination_to_idx").on(table.to_session, table.kind),
    index("coordination_project_idx").on(table.project_id, table.kind),
    index("coordination_reply_idx").on(table.reply_to),
    index("coordination_from_idx").on(table.from_session, table.kind),
    index("coordination_thread_idx").on(table.thread_id),
    // One-response invariant: at most one response row per request, enforced
    // atomically at the DB level (a responder answer and an owner answer can
    // never both land for the same request).
    uniqueIndex("coordination_response_unique")
      .on(table.reply_to)
      .where(sql`${table.kind} = 'response' AND ${table.reply_to} IS NOT NULL`),
  ],
)
