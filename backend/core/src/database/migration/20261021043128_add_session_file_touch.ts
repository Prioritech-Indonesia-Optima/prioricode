import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261021043128_add_session_file_touch",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`session_file_touch\` (
          \`project_id\` text NOT NULL,
          \`path\` text NOT NULL,
          \`from_session\` text,
          \`op\` text NOT NULL,
          \`mtime_ms\` integer NOT NULL,
          \`size\` integer NOT NULL,
          \`message_id\` text,
          \`call_id\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`session_file_touch_pk\` PRIMARY KEY(\`project_id\`, \`path\`),
          CONSTRAINT \`fk_session_file_touch_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`file_touch_project_session_idx\` ON \`session_file_touch\` (\`project_id\`,\`from_session\`);`,
      )
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`file_touch_project_time_idx\` ON \`session_file_touch\` (\`project_id\`,\`time_updated\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
