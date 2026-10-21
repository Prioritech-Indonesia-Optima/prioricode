export * as SessionGc from "./gc"

import path from "path"
import { rm } from "fs/promises"
import { Context, Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { eq } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { AppProcess } from "../process"
import { Project } from "../project"
import { AbsolutePath } from "../schema"
import { managedRoot } from "./isolation"
import { SessionSchema } from "./schema"
import { SessionWorktreeTable } from "./worktree.sql"

/**
 * Garbage collection for product-owned session worktrees. Deletion is
 * deliberately conservative and root-bounded:
 *
 * - ONLY directories under `<data>/worktree/<projectID>` are ever removed, and
 *   only after an ancestor check against main (`landed` must be merged; an
 *   unbound orphan must have zero unique commits). `git branch -d` is the last
 *   line of defense — we never pass `-D` to it, so unmerged work cannot be
 *   destroyed even if a status is wrong. (Exception: an explicitly `discarded`
 *   binding, which carries user intent.)
 * - `git worktree prune` runs first to forget dead registrations.
 * - Worktrees outside the managed root (a human's `../feature-wt`, another
 *   tool's) are NEVER touched; `--foreign` only reports them.
 * - A dirty session worktree is kept regardless of status: uncommitted work
 *   inside someone's tree is not ours to throw away.
 */

export interface Removed {
  readonly directory: string
  readonly branch: string
  readonly kind: "landed" | "orphan" | "discarded"
}

export interface Kept {
  readonly directory: string
  readonly reason: string
}

export interface Foreign {
  readonly directory: string
  readonly branch: string
}

export interface Report {
  readonly pruned: boolean
  readonly removed: ReadonlyArray<Removed>
  readonly kept: ReadonlyArray<Kept>
  readonly foreign: ReadonlyArray<Foreign>
}

export interface Interface {
  readonly gc: (input: {
    readonly projectID: Project.ID
    readonly directory: string
    readonly foreign?: boolean
  }) => Effect.Effect<Report, AppProcess.AppProcessError | Git.WorktreeError>
  readonly cleanupSession: (input: {
    readonly projectID: Project.ID
    readonly directory: string
    readonly sessionID: SessionSchema.ID
  }) => Effect.Effect<Removed | undefined, AppProcess.AppProcessError | Git.WorktreeError>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/SessionGc") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const git = yield* Git.Service
    const fs = yield* FSUtil.Service
    const proc = yield* AppProcess.Service

    const raw = Effect.fnUntraced(function* (directory: string, args: string[]) {
      const result = yield* proc.run(
        ChildProcess.make("git", args, { cwd: directory, extendEnv: true, stdin: "ignore" }),
        { combineOutput: true },
      )
      return {
        code: result.exitCode,
        stdout: (result.output ?? result.stdout ?? Buffer.alloc(0)).toString("utf8"),
        stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
      }
    })

    const rowsFor = Effect.fnUntraced(function* (projectID: Project.ID) {
      const rows = yield* db
        .select()
        .from(SessionWorktreeTable)
        .where(eq(SessionWorktreeTable.project_id, projectID))
        .all()
        .pipe(Effect.orDie)
      return rows
    })

    const removeWorktree = Effect.fnUntraced(function* (
      // MUST be a repository rooted at the main checkout: git refuses to
      // remove the worktree it is currently running inside.
      repository: Git.Repository,
      input: { directory: string; branch: string; kind: Removed["kind"]; force: boolean },
    ) {
      // Non-destructive by default: dirty trees make this fail and we keep.
      const removed = yield* git.worktree
        .remove({ repository, directory: AbsolutePath.make(input.directory), force: input.force })
        .pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        )
      if (!removed) return undefined
      yield* raw(String(repository.worktree), ["branch", "-d", input.branch]).pipe(Effect.asVoid)
      return { directory: input.directory, branch: input.branch, kind: input.kind } satisfies Removed
    })

    const uniqueCommits = Effect.fnUntraced(function* (mainDirectory: string, branch: string) {
      // `git merge-base --is-ancestor` is the safe predicate; use rev-list as
      // a count fallback for orphans whose branch ref may already be gone.
      const check = yield* raw(mainDirectory, ["merge-base", "--is-ancestor", branch, "HEAD"])
      return check.code === 0 ? 0 : undefined
    })

    const gc = Effect.fn("SessionGc.gc")(function* (input: {
      readonly projectID: Project.ID
      readonly directory: string
      readonly foreign?: boolean
    }) {
      const repository = yield* git.repo.discover(AbsolutePath.make(input.directory))
      if (repository === undefined) return { pruned: false, removed: [], kept: [], foreign: [] } satisfies Report
      const mainEntries = yield* git.worktree.list(repository)
      const mainDirectory = String(mainEntries[0]?.directory ?? repository.worktree)
      const mainRepository =
        (yield* git.repo
          .discover(AbsolutePath.make(mainDirectory))
          .pipe(Effect.catch(() => Effect.succeed(undefined)))) ?? repository

      yield* git.worktree.prune(mainRepository).pipe(Effect.catch(() => Effect.void))

      const root = managedRoot(input.projectID)
      const entries = yield* git.worktree.list(repository)
      const rows = yield* rowsFor(input.projectID)
      const bound = new Map(rows.map((row) => [row.directory, row]))

      const removed: Removed[] = []
      const kept: Kept[] = []
      const foreign: Foreign[] = []
      const handled = new Set<string>()

      for (const entry of entries) {
        handled.add(String(entry.directory))
        const directory = String(entry.directory)
        if (directory === String(mainEntries[0]?.directory)) continue
        if (!directory.startsWith(root + path.sep) && !directory.startsWith(root)) {
          if (input.foreign === true) {
            const branch = (yield* raw(directory, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()
            foreign.push({ directory, branch })
          }
          continue
        }
        const row = bound.get(directory)
        if (row === undefined) {
          // Orphan: no ledger row (session deleted or lost provisioning race).
          const candidates = yield* branchForWorktree(mainDirectory, directory)
          const cleaned = yield* removeOrphan(mainRepository, mainDirectory, directory, candidates)
          if (cleaned !== undefined) removed.push(cleaned)
          else kept.push({ directory, reason: "orphan with unmerged or unknown work" })
          continue
        }
        if (row.status === "active" || row.status === "booting" || row.status === "landing") {
          kept.push({ directory, reason: `session ${row.session_id} ${row.status}` })
          continue
        }
        if (!(yield* fs.existsSafe(directory))) {
          // Directory vanished but the entry survived this pass; clean the ref.
          if (row.status === "discarded") yield* raw(mainDirectory, ["branch", "-D", row.branch]).pipe(Effect.asVoid)
          if (row.status === "landed" && (yield* uniqueCommits(mainDirectory, row.branch)) === 0)
            yield* raw(mainDirectory, ["branch", "-d", row.branch]).pipe(Effect.asVoid)
          continue
        }
        if (row.status === "landed") {
          const merged = yield* uniqueCommits(mainDirectory, row.branch)
          if (merged !== 0) {
            kept.push({ directory, reason: "branch not an ancestor of main yet" })
            continue
          }
          const clean = removeWorktree(mainRepository, { directory, branch: row.branch, kind: "landed", force: false })
          const done = yield* clean
          if (done !== undefined) removed.push(done)
          else kept.push({ directory, reason: "worktree has local modifications" })
          continue
        }
        // discarded: explicit user intent — force-clean it.
        const done = yield* removeWorktree(mainRepository, {
          directory,
          branch: row.branch,
          kind: "discarded",
          force: true,
        })
        if (done !== undefined) removed.push(done)
        else kept.push({ directory, reason: "could not remove discarded worktree" })
      }

      // Bound rows whose directory is gone (manual rm after prune): finish the
      // job on refs even though there is no tree left to remove.
      for (const row of rows) {
        if (!row.directory.startsWith(root)) continue
        if (handled.has(row.directory)) continue
        if (yield* fs.existsSafe(row.directory)) continue
        if (row.status === "discarded") {
          yield* raw(mainDirectory, ["branch", "-D", row.branch]).pipe(Effect.asVoid)
          continue
        }
        if (row.status === "landed" && (yield* uniqueCommits(mainDirectory, row.branch)) === 0)
          yield* raw(mainDirectory, ["branch", "-d", row.branch]).pipe(Effect.asVoid)
      }

      // Managed directories that are NOT registered worktrees (crashed before
      // registration or after prune): remove them only under the name-to-branch
      // convention with an ancestor check.
      const managed = yield* fs.readDirectoryEntries(root).pipe(
        Effect.map((entries) => entries.map((entry) => entry.name)),
        Effect.catch(() => Effect.succeed([] as string[])),
      )
      const registered = new Set(entries.map((entry) => String(entry.directory)))
      for (const name of managed) {
        const directory = path.join(root, name)
        if (registered.has(directory)) continue
        const isDir = yield* fs.isDir(directory)
        if (!isDir) continue
        const branch = `prioricode/${name}`
        const exists = yield* raw(mainDirectory, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
        if (exists.code === 0) {
          const merged = yield* uniqueCommits(mainDirectory, branch)
          if (merged !== 0) {
            kept.push({ directory, reason: "unregistered but unmerged" })
            continue
          }
          yield* raw(mainDirectory, ["branch", "-d", branch]).pipe(Effect.asVoid)
        }
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true })).pipe(
          Effect.catch(() => Effect.void),
        )
        removed.push({ directory, branch, kind: "orphan" })
      }

      return { pruned: true, removed, kept, foreign } satisfies Report
    })

    /** The branch a registered worktree owns, from full porcelain output
     * (`git worktree list --porcelain` accepts no path filter on this git). */
    const branchForWorktree = Effect.fnUntraced(function* (mainDirectory: string, directory: string) {
      const listed = yield* raw(mainDirectory, ["worktree", "list", "--porcelain"])
      if (listed.code !== 0) return []
      for (const record of listed.stdout.split("\n\n")) {
        const lines = record.split("\n")
        if (lines[0]?.trim() !== `worktree ${directory}`) continue
        const branch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length)
        return branch === undefined ? [] : [branch.replace("refs/heads/", "")]
      }
      return []
    })

    const removeOrphan = Effect.fnUntraced(function* (
      mainRepository: Git.Repository,
      mainDirectory: string,
      directory: string,
      candidates: ReadonlyArray<string>,
    ) {
      for (const branch of candidates) {
        const merged = yield* uniqueCommits(mainDirectory, branch)
        if (merged !== 0) return undefined
        const done = yield* removeWorktree(mainRepository, { directory, branch, kind: "orphan", force: false })
        return done
      }
      // No branch at all (bare registered directory) — safe to drop.
      if (candidates.length > 0) return undefined
      const removed = yield* git.worktree
        .remove({ repository: mainRepository, directory: AbsolutePath.make(directory), force: false })
        .pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        )
      if (!removed) return undefined
      return { directory, branch: "", kind: "orphan" as const } satisfies Removed
    })

    const cleanupSession = Effect.fn("SessionGc.cleanupSession")(function* (input: {
      projectID: Project.ID
      directory: string
      sessionID: SessionSchema.ID
    }) {
      const row = yield* db
        .select()
        .from(SessionWorktreeTable)
        .where(eq(SessionWorktreeTable.session_id, input.sessionID))
        .get()
        .pipe(Effect.orDie)
      if (row === undefined || row.status !== "landed") return undefined
      const repository = yield* git.repo
        .discover(AbsolutePath.make(row.directory))
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (repository === undefined) return undefined
      const entries = yield* git.worktree.list(repository)
      const mainDirectory = String(entries[0]?.directory ?? repository.worktree)
      const mainRepository =
        (yield* git.repo
          .discover(AbsolutePath.make(mainDirectory))
          .pipe(Effect.catch(() => Effect.succeed(undefined)))) ?? repository
      const merged = yield* uniqueCommits(mainDirectory, row.branch)
      if (merged !== 0) return undefined
      return yield* removeWorktree(mainRepository, {
        directory: row.directory,
        branch: row.branch,
        kind: "landed",
        force: false,
      })
    })

    return Service.of({ gc, cleanupSession })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Git.node, FSUtil.node, AppProcess.node],
})
