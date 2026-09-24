import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260924000000_add_coordination_reply_guarantee",
  up(tx) {
    return Effect.gen(function* () {
      // Idempotent column additions (guarded by PRAGMA table_info)
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`session_coordination\`)`)
      const names = new Set(columns.map((c) => c.name))

      if (!names.has("deadline")) {
        yield* tx.run(`ALTER TABLE \`session_coordination\` ADD \`deadline\` integer;`)
      }
      if (!names.has("time_escalated")) {
        yield* tx.run(`ALTER TABLE \`session_coordination\` ADD \`time_escalated\` integer;`)
      }
      if (!names.has("time_expired")) {
        yield* tx.run(`ALTER TABLE \`session_coordination\` ADD \`time_expired\` integer;`)
      }
      if (!names.has("thread_id")) {
        yield* tx.run(`ALTER TABLE \`session_coordination\` ADD \`thread_id\` text;`)
      }

      // Idempotent index creation
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`coordination_thread_idx\` ON \`session_coordination\` (\`thread_id\`);`,
      )

      // Dedupe existing duplicate response rows before creating the unique index.
      // Keep the lowest id (earliest) response per request; delete the rest.
      yield* tx.run(`
        DELETE FROM \`session_coordination\`
        WHERE \`kind\` = 'response'
          AND \`reply_to\` IS NOT NULL
          AND \`id\` NOT IN (
            SELECT MIN(\`id\`)
            FROM \`session_coordination\`
            WHERE \`kind\` = 'response' AND \`reply_to\` IS NOT NULL
            GROUP BY \`reply_to\`
          );
      `)

      // Unique partial index: at most one response row per request.
      // Enforces the one-response invariant atomically at the DB level.
      yield* tx.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS \`coordination_response_unique\`
        ON \`session_coordination\` (\`reply_to\`)
        WHERE \`kind\` = 'response' AND \`reply_to\` IS NOT NULL;
      `)
    })
  },
} satisfies DatabaseMigration.Migration
