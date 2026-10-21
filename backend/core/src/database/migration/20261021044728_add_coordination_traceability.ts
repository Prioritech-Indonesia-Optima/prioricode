import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261021044728_add_coordination_traceability",
  up(tx) {
    return Effect.gen(function* () {
      // Idempotent column additions (guarded by PRAGMA table_info) so a
      // cross-process migration race replays safely.
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`session_coordination\`)`)
      const names = new Set(columns.map((c) => c.name))

      if (!names.has("origin_message_id")) {
        yield* tx.run(`ALTER TABLE \`session_coordination\` ADD \`origin_message_id\` text;`)
      }
      if (!names.has("origin_call_id")) {
        yield* tx.run(`ALTER TABLE \`session_coordination\` ADD \`origin_call_id\` text;`)
      }
      if (!names.has("group_id")) {
        yield* tx.run(`ALTER TABLE \`session_coordination\` ADD \`group_id\` text;`)
      }

      // Idempotent index creation
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`coordination_group_idx\` ON \`session_coordination\` (\`group_id\`);`)

      // Purge rows of the pruned subsystems: path claims and idle-notify
      // subscriptions are no longer written or read by any code path.
      yield* tx.run(`DELETE FROM \`session_coordination\` WHERE \`kind\` IN ('claim', 'notify');`)
    })
  },
} satisfies DatabaseMigration.Migration
