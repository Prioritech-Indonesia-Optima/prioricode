import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261021183909_add_worktree_isolation_ledgers",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`land_claim\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`branch\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`base_oid\` text NOT NULL,
          \`green_tree_oid\` text,
          \`merge_oid\` text,
          \`deadline\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_land_claim_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`session_worktree\` (
          \`session_id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`branch\` text NOT NULL,
          \`base_sha\` text NOT NULL,
          \`status\` text NOT NULL,
          \`merge_sha\` text,
          \`time_landed\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_worktree_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_worktree_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      // Guarded ADD COLUMN: cross-process migration races replay up() on a DB
      // where the column already exists; bare ALTER would abort the transaction.
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`session_file_touch\`)`)
      if (!columns.some((column) => column.name === "relative_path")) {
        yield* tx.run(`ALTER TABLE \`session_file_touch\` ADD \`relative_path\` text;`)
      }
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`file_touch_project_relative_idx\` ON \`session_file_touch\` (\`project_id\`,\`relative_path\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS \`session_worktree_project_directory_idx\` ON \`session_worktree\` (\`project_id\`,\`directory\`);`,
      )
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`session_worktree_project_status_idx\` ON \`session_worktree\` (\`project_id\`,\`status\`);`,
      )
      // Backfill repo-relative form for existing rows that live under the
      // project's primary worktree (slash-normalized writes). Rows outside the
      // primary tree stay NULL = exact-match only; a miss beats a guess.
      yield* tx.run(`
        UPDATE \`session_file_touch\` SET \`relative_path\` = substr(\`path\`, length((SELECT \`worktree\` FROM \`project\` WHERE \`project\`.\`id\` = \`session_file_touch\`.\`project_id\`)) + 2)
        WHERE \`relative_path\` IS NULL
          AND \`path\` LIKE (SELECT \`worktree\` FROM \`project\` WHERE \`project\`.\`id\` = \`session_file_touch\`.\`project_id\`) || '/%';
      `)
    })
  },
} satisfies DatabaseMigration.Migration
