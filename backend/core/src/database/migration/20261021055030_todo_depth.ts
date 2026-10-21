import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261021055030_todo_depth",
  up(tx) {
    return Effect.gen(function* () {
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`todo\`)`)
      if (!columns.some((column) => column.name === "depth")) {
        yield* tx.run(`ALTER TABLE \`todo\` ADD \`depth\` integer;`)
      }
      yield* tx.run(`UPDATE \`todo\` SET \`depth\` = 0 WHERE \`depth\` IS NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
