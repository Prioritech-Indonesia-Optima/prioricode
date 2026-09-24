import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260924081757_add_session_presence",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`session_presence\` (
          \`session_id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`state\` text NOT NULL,
          \`time_changed\` integer NOT NULL,
          \`pid\` integer,
          \`time_heartbeat\` integer NOT NULL,
          CONSTRAINT \`fk_session_presence_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
