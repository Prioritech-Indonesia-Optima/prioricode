import path from "path"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { SessionGc } from "@prioricode/core/session/gc"
import { UI } from "../ui"

export const WorktreeCommand = cmd({
  command: "worktree",
  describe: "manage product-owned session worktrees",
  builder: (yargs) => yargs.command(GcCommand).demandCommand(),
  async handler() {},
})

const GcCommand = effectCmd({
  command: "gc",
  describe: "prune stale worktrees; landed/merged and discarded session trees are retired",
  builder: (yargs) =>
    yargs.option("foreign", {
      describe: "also report (never touch) worktrees outside the managed root",
      type: "boolean",
    }),
  handler: Effect.fn("Cli.worktree.gc")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("worktree gc must run inside a PrioriCode project directory")
    if (ctx.project.vcs !== "git") return yield* fail("worktree gc requires a git project")

    const gc = yield* SessionGc.Service
    const report = yield* gc
      .gc({ projectID: ctx.project.id, directory: ctx.worktree, foreign: args.foreign })
      .pipe(Effect.catch((cause) => fail(`worktree gc failed: ${String(cause)}`)))

    for (const item of report.removed)
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD + "removed" + UI.Style.TEXT_NORMAL + ` ${item.kind.padEnd(9)} ${path.basename(item.directory)}  ${item.branch}`,
      )
    for (const item of report.kept)
      UI.println(UI.Style.TEXT_DIM + `kept      ${path.basename(item.directory)}  ${item.reason}` + UI.Style.TEXT_NORMAL)
    if (args.foreign)
      for (const item of report.foreign)
        UI.println(UI.Style.TEXT_WARNING_BOLD + "foreign" + UI.Style.TEXT_NORMAL + ` (untouched) ${item.directory}  ${item.branch}`)
    UI.println(
      UI.Style.TEXT_NORMAL +
        `prune ok; removed ${report.removed.length}, kept ${report.kept.length}${args.foreign ? `, foreign ${report.foreign.length}` : ""}`,
    )
  }),
})
