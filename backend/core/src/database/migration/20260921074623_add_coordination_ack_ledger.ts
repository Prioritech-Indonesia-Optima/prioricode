import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260921074623_add_coordination_ack_ledger",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_coordination\` ADD \`time_ack\` integer;`)
      yield* tx.run(`ALTER TABLE \`session_coordination\` ADD \`claimed_by\` text;`)
      // Backfill: historical rows that were already marked read under the old
      // two-state scheme are treated as acked. Without this, the first recovery
      // sweep after upgrade would unclaim every delivered note ever and re-wake
      // whole projects with weeks-old coordination chatter.
      yield* tx.run(
        `UPDATE \`session_coordination\` SET \`time_ack\` = \`time_read\` WHERE \`time_read\` IS NOT NULL AND \`time_ack\` IS NULL;`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
