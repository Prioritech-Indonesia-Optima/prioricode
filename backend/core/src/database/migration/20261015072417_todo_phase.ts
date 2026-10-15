import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261015072417_todo_phase",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`todo\` ADD \`phase\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
