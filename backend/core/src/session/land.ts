export * as SessionLand from "./land"

import { Context, Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { eq } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { FileTouch } from "../file-touch"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { AppProcess } from "../process"
import { Project } from "../project"
import { SessionGc } from "./gc"
import { AbsolutePath } from "../schema"
import { EffectFlock } from "../util/effect-flock"
import { SessionIsolation } from "./isolation"
import { SessionVerify } from "./runner/verify"
import { SessionSchema } from "./schema"
import { LandClaimTable, landClaimId } from "./worktree.sql"

/**
 * Coordinated landing of a session branch onto the project's main branch.
 *
 * The flow is plumbing-level and CAS-guarded: `merge-tree` previews conflicts
 * without touching any working tree, the claim row + project flock serialize
 * concurrent landings, the primary checkout must be provably clean at the
 * instant of the ref move (otherwise the landing DEFERS — it never stashes or
 * resets work that might belong to the human or a peer session), and the
 * result is always a structured envelope an agent can negotiate with. It
 * NEVER PUSHES: publishing main stays a human decision.
 */

export interface Owner {
  readonly path: string
  readonly sessionID: string
}

export type Refusal =
  | { readonly reason: "no-binding"; readonly next: ReadonlyArray<string> }
  | { readonly reason: "bad-status"; readonly status: string }
  | { readonly reason: "repo-missing" }
  | { readonly reason: "verify-failed"; readonly command: string; readonly exit: number; readonly tail: string }
  | { readonly reason: "no-verify-command"; readonly next: ReadonlyArray<string> }
  | { readonly reason: "conflict"; readonly paths: ReadonlyArray<string>; readonly owners: ReadonlyArray<Owner> }
  | { readonly reason: "primary-dirty"; readonly paths: ReadonlyArray<string> }
  | { readonly reason: "claimed" }
  | { readonly reason: "cas-lost" }
  | {
      readonly reason: "merged-verify-failed"
      readonly command: string
      readonly exit: number
      readonly tail: string
      readonly reverted: boolean
    }
  | { readonly reason: "preview"; readonly files: ReadonlyArray<string>; readonly dirtyPrimary: ReadonlyArray<string> }
  | { readonly reason: "error"; readonly message: string }

export type LandResult =
  | {
      readonly landed: true
      readonly branch: string
      readonly mergeSha: string
      readonly checkout: "synced" | "stale"
      readonly note?: string
    }
  | ({ readonly landed: false } & Refusal)

export interface Input {
  readonly sessionID: SessionSchema.ID
  readonly projectID: Project.ID
  /** Override the auto-detected verification command (e.g. per-package suites). */
  readonly command?: string
  /** Report would-change paths, conflicts and dirt without merging anything. */
  readonly dryRun?: boolean
}

export interface Interface {
  readonly land: (input: Input) => Effect.Effect<LandResult>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/SessionLand") {}

interface Raw {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

const CLAIM_TTL_MILLIS = 15 * 60_000

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const git = yield* Git.Service
    const fs = yield* FSUtil.Service
    const proc = yield* AppProcess.Service
    const flock = yield* EffectFlock.Service
    const isolation = yield* SessionIsolation.Service
    const touches = yield* FileTouch.Service
    const gc = yield* SessionGc.Service

    const raw = Effect.fnUntraced(function* (directory: string, args: string[]) {
      const result = yield* proc.run(
        ChildProcess.make("git", args, { cwd: directory, extendEnv: true, stdin: "ignore" }),
        { combineOutput: true },
      )
      return {
        code: result.exitCode,
        stdout: (result.output ?? result.stdout ?? Buffer.alloc(0)).toString("utf8"),
        stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
      } satisfies Raw
    })

    const primaryDirty = Effect.fnUntraced(function* (mainDirectory: string) {
      const status = yield* raw(mainDirectory, ["status", "--porcelain"])
      if (status.code !== 0) return []
      return status.stdout
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter((line) => line !== "")
    })

    /** Relative paths git reported as conflicting in merge-tree output. */
    const conflictPaths = (text: string): ReadonlyArray<string> => {
      const found = new Set<string>()
      for (const line of text.split("\n")) {
        const match = /Merge conflict in (.+)$/.exec(line.trim())
        if (match?.[1]) found.add(match[1])
      }
      return [...found]
    }

    const ownersFor = Effect.fnUntraced(function* (
      projectID: Project.ID,
      sessionID: SessionSchema.ID,
      paths: ReadonlyArray<string>,
    ) {
      if (paths.length === 0) return []
      const rows = yield* touches
        .lookupRelative({ projectID, paths, excludeSessionID: String(sessionID) })
        .pipe(Effect.catch(() => Effect.succeed([] as FileTouch.Touch[])))
      const owners: Owner[] = []
      const seen = new Set<string>()
      for (const row of rows) {
        const relativePath = row.relativePath ?? row.path
        if (seen.has(relativePath)) continue
        seen.add(relativePath)
        owners.push({ path: relativePath, sessionID: row.sessionID ?? "external" })
      }
      return owners
    })

    const accept = (result: {
      branch: string
      mergeSha: string
      checkout: "synced" | "stale"
      note?: string
      retired?: boolean
    }) => ({ landed: true, ...result }) satisfies LandResult

    const retire = (gc: SessionGc.Interface, input: Input, binding: SessionIsolation.Binding) =>
      gc.cleanupSession({ projectID: input.projectID, directory: binding.directory, sessionID: input.sessionID }).pipe(
        Effect.match({ onFailure: () => undefined, onSuccess: (done) => (done === undefined ? undefined : true) }),
        Effect.map((done) => (done === undefined ? {} : { retired: true })),
      )
    const refuse = (refusal: Refusal) => ({ landed: false, ...refusal }) satisfies LandResult

    const attempt = Effect.fnUntraced(function* (input: Input) {
      const binding = yield* isolation.binding(input.sessionID)
      if (binding === undefined)
        return refuse({
          reason: "no-binding",
          next: [
            "this session is not isolated on its own branch; merge its work manually or reland from an isolated session",
          ],
        })
      if (binding.status === "landed")
        return accept({ branch: binding.branch, mergeSha: binding.mergeSha ?? binding.baseSha, checkout: "stale" })
      if (binding.status !== "active" && binding.status !== "booting")
        return refuse({ reason: "bad-status", status: binding.status })
      if (!(yield* fs.existsSafe(binding.directory))) return refuse({ reason: "repo-missing" })

      const worktree = yield* git.repo.discover(AbsolutePath.make(binding.directory))
      if (worktree === undefined) return refuse({ reason: "repo-missing" })
      const entries = yield* git.worktree.list(worktree)
      const mainDirectory = String(entries[0]?.directory ?? worktree.worktree)

      const mainBranch = (yield* raw(mainDirectory, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()
      if (mainBranch === "" || mainBranch === binding.branch)
        return refuse({ reason: "error", message: "main branch unavailable or session branch is checked out" })

      const claimKey = landClaimId(input.projectID, binding.branch)
      // Same-branch races are refused by the claim primary key; different
      // branches serialize on the project flock around the ref move.
      const claimed = yield* db
        .insert(LandClaimTable)
        .values({
          id: claimKey,
          project_id: input.projectID,
          branch: binding.branch,
          session_id: input.sessionID,
          status: "reserved",
          base_oid: binding.baseSha,
          deadline: Date.now() + CLAIM_TTL_MILLIS,
        })
        .onConflictDoNothing()
        .returning({ id: LandClaimTable.id })
        .get()
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (claimed === undefined) return refuse({ reason: "claimed" })

      try {
        const oldSha = (yield* raw(mainDirectory, ["rev-parse", "HEAD"])).stdout.trim()
        const branchSha = (yield* raw(mainDirectory, ["rev-parse", `refs/heads/${binding.branch}`])).stdout.trim()
        if (oldSha === "" || branchSha === "") return refuse({ reason: "repo-missing" })

        const merged = yield* raw(mainDirectory, ["merge-tree", "--write-tree", oldSha, branchSha])
        // merge-tree exits 1 on conflicts; >=2 is a genuine error.
        if (merged.code >= 2) return refuse({ reason: "error", message: merged.stderr.trim() || merged.stdout.trim() })
        const treeSha = merged.stdout.split("\n")[0]?.trim() ?? ""
        if (treeSha === "") return refuse({ reason: "error", message: "merge-tree produced no tree" })

        if (merged.code !== 0) {
          const paths = conflictPaths(`${merged.stdout}\n${merged.stderr}`)
          const owners = yield* ownersFor(input.projectID, input.sessionID, paths)
          return refuse({ reason: "conflict", paths, owners })
        }

        const dirty = yield* primaryDirty(mainDirectory)
        if (input.dryRun === true) {
          const diff = yield* raw(mainDirectory, ["diff", "--name-only", oldSha, treeSha])
          return refuse({
            reason: "preview",
            files: diff.stdout.split("\n").filter((line) => line !== ""),
            dirtyPrimary: dirty,
          })
        }

        // The primary-clean gate (computed before the preview branch) runs
        // BEFORE the potentially long verification so a doomed land is cheap.
        if (dirty.length > 0) return refuse({ reason: "primary-dirty", paths: dirty })

        // Green gate on the session's own tree before anything touches main.
        const check = yield* SessionVerify.runOnce({
          fs,
          process: proc,
          directory: binding.directory,
          command: input.command,
        })
        if (!check.ok)
          return refuse({ reason: "verify-failed", command: check.command ?? "", exit: check.exit, tail: check.tail })
        // A tree we cannot verify is NOT silently green: refuse (risk register —
        // "no test command = explicit refuse"). Explicit input.command or a
        // worktree.verify config resolved by the caller keeps land usable.
        if (check.command === undefined)
          return refuse({
            reason: "no-verify-command",
            next: [
              "pass command=... on this call, set worktree.verify in the project config, or add a test script",
              "do not guess a verification — an unverified merge onto main is the failure mode this gate exists to prevent",
            ],
          })

        // The checkout gate is re-read immediately before the move: it was
        // possibly dirtied while verification ran.
        const dirtyNow = yield* primaryDirty(mainDirectory)
        if (dirtyNow.length > 0) return refuse({ reason: "primary-dirty", paths: dirtyNow })

        const commit = yield* raw(mainDirectory, [
          "commit-tree",
          treeSha,
          "-p",
          oldSha,
          "-p",
          branchSha,
          "-m",
          `merge ${binding.branch} (prioricode land ${String(input.sessionID)})`,
        ])
        if (commit.code !== 0)
          return refuse({
            reason: "error",
            message: commit.stderr.trim() || commit.stdout.trim() || "commit-tree failed",
          })
        const newSha = commit.stdout.trim()
        if (newSha === "") return refuse({ reason: "error", message: "commit-tree produced no object" })

        const cas = yield* raw(mainDirectory, ["update-ref", `refs/heads/${mainBranch}`, newSha, oldSha])
        if (cas.code !== 0) return refuse({ reason: "cas-lost" })

        yield* isolation.setStatus(input.sessionID, "landed", newSha)

        // Align the primary checkout with the moved ref. Post-CAS a status
        // re-check is meaningless (HEAD now legitimately differs from the
        // lagging worktree), so safety comes from the dirty gate immediately
        // above and the project-wide flock: the window for a racing local edit
        // is milliseconds. If reset itself fails, leave the checkout untouched
        // and report "stale" with instructions instead of forcing anything.
        const sync = yield* raw(mainDirectory, ["reset", "--hard", newSha])
        if (sync.code === 0) {
          // Merged-tree re-check: the branch was green and main was green, but
          // the COMBINATION is the tree we just put on main. Verification runs
          // in the synced primary checkout (real environment: installed deps);
          // a red merged tree is rolled back with a reverse CAS and the caller
          // gets the failure to fix on their branch.
          const recheck = yield* SessionVerify.runOnce({
            fs,
            process: proc,
            directory: mainDirectory,
            command: check.command,
          })
          if (!recheck.ok) {
            const rollback = yield* raw(mainDirectory, ["update-ref", `refs/heads/${mainBranch}`, oldSha, newSha])
            if (rollback.code === 0) {
              yield* raw(mainDirectory, ["reset", "--hard", oldSha])
              yield* isolation.setStatus(input.sessionID, "active")
            }
            return refuse({
              reason: "merged-verify-failed",
              command: recheck.command ?? check.command ?? "",
              exit: recheck.exit,
              tail: recheck.tail,
              reverted: rollback.code === 0,
            })
          }
          const retired = yield* retire(gc, input, binding)
          return accept({ branch: binding.branch, mergeSha: newSha, checkout: "synced", ...retired })
        }
        return accept({
          branch: binding.branch,
          mergeSha: newSha,
          checkout: "stale",
          note: `main ref moved; the primary checkout could not be synced automatically. Align it manually with git reset --hard ${newSha} once you are sure no local edits are in flight.`,
        })
      } finally {
        yield* db
          .delete(LandClaimTable)
          .where(eq(LandClaimTable.id, claimKey))
          .run()
          .pipe(Effect.catch(() => Effect.void))
      }
    })

    const land = Effect.fn("SessionLand.land")(function* (input: Input) {
      return yield* flock.acquire(`land:${String(input.projectID)}`).pipe(
        Effect.flatMap(() => attempt(input)),
        Effect.scoped,
        Effect.catch(() => Effect.succeed(refuse({ reason: "claimed" }))),
      )
    })

    const landSafe = (input: Input) =>
      land(input).pipe(
        Effect.match({
          onFailure: (cause) => ({ landed: false as const, reason: "error" as const, message: String(cause) }),
          onSuccess: (result) => result,
        }),
      )

    return Service.of({ land: landSafe })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    Git.node,
    FSUtil.node,
    AppProcess.node,
    EffectFlock.node,
    SessionIsolation.node,
    SessionGc.node,
    FileTouch.node,
  ],
})
