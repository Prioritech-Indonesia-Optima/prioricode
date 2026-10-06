import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260915061057_session_coordination",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_coordination\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`from_session\` text NOT NULL,
          \`to_session\` text,
          \`body\` text NOT NULL,
          \`reply_to\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_read\` integer,
          CONSTRAINT \`fk_session_coordination_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`coordination_to_idx\` ON \`session_coordination\` (\`to_session\`,\`kind\`);`)
      yield* tx.run(`CREATE INDEX \`coordination_project_idx\` ON \`session_coordination\` (\`project_id\`,\`kind\`);`)
      yield* tx.run(`CREATE INDEX \`coordination_reply_idx\` ON \`session_coordination\` (\`reply_to\`);`)
      yield* tx.run(`CREATE INDEX \`coordination_from_idx\` ON \`session_coordination\` (\`from_session\`,\`kind\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
