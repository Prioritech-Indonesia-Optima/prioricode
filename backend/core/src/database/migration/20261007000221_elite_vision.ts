import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261007000221_elite_vision",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP TABLE \`data_migration\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
