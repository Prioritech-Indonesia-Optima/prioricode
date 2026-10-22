export * as ConfigWorktree from "./worktree"

import { Schema } from "effect"

/**
 * Branch-per-session isolation. The user-visible unit is the BRANCH; the git
 * worktree is hidden plumbing under the data directory, created for the session
 * at create time and garbage-collected after it lands. ON by default;
 * `isolateSessions: false` opts out, `PRIORICODE_DISABLE_WORKTREE_ISOLATE`
 * overrides everything.
 */
export class Info extends Schema.Class<Info>("ConfigV2.Worktree")({
  isolateSessions: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Give every new root session its own branch + managed worktree so concurrent sessions never share a checkout (default: true). Children inherit their parent's worktree regardless",
  }),
  verify: Schema.String.pipe(Schema.optional).annotate({
    description:
      "Verification command for the land gate when no explicit command is given (e.g. 'bun run typecheck' in repos whose root test intentionally fails)",
  }),
  setupCommand: Schema.String.pipe(Schema.optional).annotate({
    description:
      "Shell command run once in a freshly provisioned session worktree before it is used, e.g. 'bun install' (default: none)",
  }),
}) {}
