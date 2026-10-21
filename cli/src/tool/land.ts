import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./land.txt"
import { SessionLand } from "@prioricode/core/session/land"
import { Session } from "@/session/session"
import { SessionID } from "../session/schema"

export const Parameters = Schema.Struct({
  session: Schema.optional(Schema.String).annotate({
    description: "Session id to land; defaults to this session. Only isolated sessions with a branch binding can land.",
  }),
  command: Schema.optional(Schema.String).annotate({
    description: "Override the auto-detected verification command (e.g. a per-package test run).",
  }),
  dry_run: Schema.optional(Schema.Boolean).annotate({
    description: "Preview would-change files, conflicts, and checkout dirt without merging anything.",
  }),
})

type Metadata = {
  outcome: string
  branch?: string
  mergeSha?: string
  paths?: ReadonlyArray<string>
}

export const LandTool = Tool.define(
  "land",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const land = yield* SessionLand.Service

    const run = Effect.fn("LandTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<Metadata>,
    ) {
      const target = params.session === undefined ? ctx.sessionID : SessionID.make(params.session)
      const info = yield* sessions.get(target).pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)))
      if (info === undefined)
        return result("error", `no session ${target} exists in this project`, { outcome: "error" })
      if (target !== ctx.sessionID && info.parentID !== ctx.sessionID)
        return result("error", "land only accepts your own session or one of your children", { outcome: "error" })

      yield* ctx.ask({
        permission: "land",
        patterns: [target],
        always: ["*"],
        metadata: { outcome: "request" },
      })

      const outcome = yield* land.land({
        sessionID: target,
        projectID: info.projectID,
        ...(params.command === undefined ? {} : { command: params.command }),
        ...(params.dry_run === undefined ? {} : { dryRun: params.dry_run }),
      })

      if (outcome.landed) {
        const short = outcome.mergeSha.slice(0, 7)
        const lines = [
          `LANDED ${outcome.branch} -> main at ${short} (checkout ${outcome.checkout}).`,
          ...(outcome.checkout === "stale" ? [`WARNING: ${outcome.note ?? "primary checkout not synced."}`] : []),
          "NOT PUSHED: publishing main is a human decision. Tell the user the landed sha; do not run git push on your own.",
          `GC will retire ${outcome.branch}'s worktree once it is safe to do so.`,
        ]
        return result("landed", lines.join("\n"), {
          outcome: "landed",
          branch: outcome.branch,
          mergeSha: outcome.mergeSha,
        })
      }

      switch (outcome.reason) {
        case "conflict": {
          const owners = outcome.owners.map((owner) => `${owner.path} <- ${owner.sessionID}`)
          return result(
            "conflict",
            [
              "CONFLICT: the merge is not clean; nothing moved.",
              `Conflicting paths: ${outcome.paths.join(", ")}`,
              ...(owners.length > 0 ? ["Recent writers: ", ...owners] : []),
              "Negotiate with the `sessions` tool (query who owns what, or agree an order), rebase onto current main, then land again.",
            ].join("\n"),
            { outcome: "conflict", paths: outcome.paths },
          )
        }
        case "primary-dirty":
          return result(
            "deferred",
            [
              `DEFERRED: the primary checkout has uncommitted changes (${outcome.paths.join(", ")}).`,
              "Do not stash or reset it. Ask the user to commit or clean their checkout, then retry.",
            ].join("\n"),
            { outcome: "deferred", paths: outcome.paths },
          )
        case "verify-failed":
          return result(
            "red",
            [
              `BLOCKED: verification failed in your tree (\`${outcome.command}\` exited ${outcome.exit}).`,
              "Fix the failures on your branch first — do not retry land until it is green.",
              "",
              outcome.tail,
            ].join("\n"),
            { outcome: "red" },
          )
        case "no-binding":
          return result(
            "unbound",
            ["NOT ISOLATED: this session has no branch binding, so there is nothing to land.", ...outcome.next].join(
              "\n",
            ),
            { outcome: "unbound" },
          )
        case "claimed":
          return result(
            "claimed",
            "A landing for this branch is already in flight (claim held elsewhere). Retry shortly.",
            {
              outcome: "claimed",
            },
          )
        case "merged-verify-failed":
          return result(
            "red-merged",
            [
              `ROLLED BACK: the merged result fails verification on main (\`${outcome.command}\` exited ${outcome.exit}); main was reverted${outcome.reverted ? " and the landing can be retried after fixing your branch" : " — CHECK main state manually"}.`,
              "",
              outcome.tail,
            ].join("\n"),
            { outcome: "red-merged" },
          )
        case "cas-lost":
          return result("cas-lost", "main moved during the landing. Rebase onto the new main and land again.", {
            outcome: "cas-lost",
          })
        case "preview":
          return result(
            "preview",
            [
              `DRY RUN: clean merge of ${outcome.files.length} file(s).`,
              ...outcome.files.map((file) => `  ${file}`),
              ...(outcome.dirtyPrimary.length > 0
                ? [`Primary checkout is currently dirty (${outcome.dirtyPrimary.length} paths) — landing would defer.`]
                : ["Primary checkout is clean — landing would proceed."]),
            ].join("\n"),
            { outcome: "preview", paths: outcome.files },
          )
        case "bad-status":
          return result("bad-status", `Session binding is in status "${outcome.status}" and cannot land.`, {
            outcome: "bad-status",
          })
        case "repo-missing":
          return result("repo-missing", "The session's repository or branch could not be found; nothing moved.", {
            outcome: "repo-missing",
          })
        case "error":
          return result("error", `LAND ERROR: ${outcome.message}`, { outcome: "error" })
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

function result(outcome: string, output: string, metadata: Metadata) {
  return { title: `land:${outcome}`, output, metadata }
}
