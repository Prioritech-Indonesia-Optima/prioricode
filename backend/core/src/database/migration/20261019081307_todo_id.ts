import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261019081307_todo_id",
  up(tx) {
    return Effect.gen(function* () {
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`todo\`)`)
      if (!columns.some((column) => column.name === "id")) {
        yield* tx.run(`ALTER TABLE \`todo\` ADD \`id\` text;`)
      }
      yield* tx.run(`UPDATE \`todo\` SET \`id\` = 'td_' || lower(hex(randomblob(4))) WHERE \`id\` IS NULL;`)
      yield* tx.run(`CREATE UNIQUE INDEX IF NOT EXISTS \`todo_session_id_idx\` ON \`todo\` (\`session_id\`,\`id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
