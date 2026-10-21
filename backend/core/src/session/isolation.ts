export * as SessionIsolation from "./isolation"

import path from "path"
import { Context, Duration, Effect, Layer, Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { eq } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { Flag } from "../flag/flag"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { Global } from "../global"
import { AppProcess } from "../process"
import { Project } from "../project"
import { ProjectTable } from "../project/sql"
import { AbsolutePath } from "../schema"
import { Slug } from "../util/slug"
import { SessionSchema } from "./schema"
import { SessionWorktreeTable } from "./worktree.sql"

/**
 * Branch-per-session provisioning. The policy lives HERE so both create paths
 * (v1 CLI sessions and V2 core sessions) resolve isolation identically, and
 * the repo stays clean: managed worktrees live under
 * `<data>/worktree/<projectID>/`, never beside the user's checkout.
 *
 * `provision` is pure git (safe to run before the session row exists);
 * `bind` records the ledger row and starts setup, and must run AFTER the
 * Created event projected the session (the binding row references it).
 *
 * Contract: neither step may fail the create. Any missing precondition, git
 * error, or collision degrades to shared mode (the requested directory) with a
 * log line. Children inherit their parent's tree (skip), and directories that
 * are already linked worktrees of the repo are adopted (bound, nothing
 * created) so sessions spawned inside an isolated tree — or a hand-rolled one
 * — still get land/GC.
 */
export interface ProvisionInput {
  readonly projectID: Project.ID
  readonly sessionID: SessionSchema.ID
  readonly directory: string
  /** "git" only when the project resolved with git VCS. */
  readonly vcs?: string
  readonly parentID?: SessionSchema.ID
  /** Per-session override from the create input; wins over config. */
  readonly isolation?: "worktree" | "shared"
  /** Caller-resolved config default (worktree.isolateSessions). */
  readonly enabled: boolean
}

export interface Plan {
  readonly directory: string
  readonly branch: string
  readonly baseSha: string
  readonly adopted: boolean
}

export interface BindInput {
  readonly sessionID: SessionSchema.ID
  readonly projectID: Project.ID
  readonly plan: Plan
  readonly setupCommand?: string
}

export interface Binding {
  readonly sessionID: string
  readonly projectID: string
  readonly directory: string
  readonly branch: string
  readonly baseSha: string
  readonly status: string
  readonly mergeSha?: string
}

export interface ProvisionResult {
  readonly directory: string
  readonly plan?: Plan
  readonly failed?: true
}

export interface Interface {
  readonly provision: (input: ProvisionInput) => Effect.Effect<ProvisionResult>
  readonly bind: (input: BindInput) => Effect.Effect<void>
  readonly binding: (sessionID: SessionSchema.ID) => Effect.Effect<Binding | undefined>
  readonly setStatus: (
    sessionID: SessionSchema.ID,
    status: "active" | "landing" | "landed" | "discarded",
    mergeSha?: string,
  ) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/SessionIsolation") {}

/** All product-created session worktrees for a project live here — the ONLY
 * root the GC may ever delete from. */
export const managedRoot = (projectID: Project.ID) => path.join(Global.Path.data, "worktree", String(projectID))

const toBinding = (row: typeof SessionWorktreeTable.$inferSelect): Binding => ({
  sessionID: row.session_id,
  projectID: row.project_id,
  directory: row.directory,
  branch: row.branch,
  baseSha: row.base_sha,
  status: row.status,
  ...(row.merge_sha === null ? {} : { mergeSha: row.merge_sha }),
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const git = yield* Git.Service
    const fs = yield* FSUtil.Service
    const proc = yield* AppProcess.Service
    const scope = yield* Scope.Scope

    const binding = Effect.fn("SessionIsolation.binding")(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select()
        .from(SessionWorktreeTable)
        .where(eq(SessionWorktreeTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      return row ? toBinding(row) : undefined
    })

    const setStatus = Effect.fn("SessionIsolation.setStatus")(function* (
      sessionID: SessionSchema.ID,
      status: "active" | "landing" | "landed" | "discarded",
      mergeSha?: string,
    ) {
      yield* db
        .update(SessionWorktreeTable)
        .set({
          status,
          ...(mergeSha === undefined ? {} : { merge_sha: mergeSha }),
          ...(status === "landed" ? { time_landed: Date.now() } : {}),
        })
        .where(eq(SessionWorktreeTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
    })

    const insertBinding = Effect.fnUntraced(function* (input: {
      sessionID: SessionSchema.ID
      projectID: Project.ID
      plan: Plan
      status: "booting" | "active"
    }) {
      yield* db
        .insert(SessionWorktreeTable)
        .values({
          session_id: input.sessionID,
          project_id: input.projectID,
          directory: input.plan.directory,
          branch: input.plan.branch,
          base_sha: input.plan.baseSha,
          status: input.status,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
    })

    const registerSandbox = Effect.fnUntraced(function* (projectID: Project.ID, directory: string) {
      const row = yield* db
        .select({ sandboxes: ProjectTable.sandboxes })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, projectID))
        .get()
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!row) return
      if (row.sandboxes.some((sandbox) => String(sandbox) === directory)) return
      yield* db
        .update(ProjectTable)
        .set({ sandboxes: [...row.sandboxes, AbsolutePath.make(directory)] })
        .where(eq(ProjectTable.id, projectID))
        .run()
        .pipe(Effect.catch(() => Effect.void))
    })

    const runSetup = (input: BindInput) =>
      proc
        .run(
          ChildProcess.make(input.setupCommand ?? "", [], {
            cwd: input.plan.directory,
            shell: process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh",
            stdin: "ignore",
            forceKillAfter: Duration.seconds(5),
          }),
          { combineOutput: true },
        )
        .pipe(
          Effect.tap(() => Effect.logInfo("worktree setup finished", { sessionID: input.sessionID, directory: input.plan.directory })),
          Effect.catch((cause) =>
            Effect.logWarning("worktree setup failed", { sessionID: input.sessionID, directory: input.plan.directory, cause }),
          ),
          Effect.andThen(setStatus(input.sessionID, "active")),
          Effect.forkIn(scope),
        )

    const bind = Effect.fn("SessionIsolation.bind")(function* (input: BindInput) {
      if (input.plan.adopted === false && input.setupCommand !== undefined) {
        yield* insertBinding({ ...input, status: "booting" })
        yield* registerSandbox(input.projectID, input.plan.directory)
        yield* runSetup(input)
        return
      }
      yield* insertBinding({ ...input, status: "active" })
      if (input.plan.adopted === false) yield* registerSandbox(input.projectID, input.plan.directory)
    })

    const provision = Effect.fn("SessionIsolation.provision")(function* (input: ProvisionInput) {
      const wanted =
        Flag.PRIORICODE_DISABLE_WORKTREE_ISOLATE || input.isolation === "shared"
          ? false
          : (Flag.PRIORICODE_WORKTREE_ISOLATE ?? (input.isolation === "worktree" ? true : input.enabled))
      // Children inherit the parent's tree; non-git projects never provision.
      if (!wanted || input.parentID !== undefined || input.vcs !== "git") return { directory: input.directory }
      // Re-entry: this session's tree was already decided; never double-provision.
      const existing = yield* binding(input.sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (existing !== undefined)
        return {
          directory: existing.directory,
          plan: { directory: existing.directory, branch: existing.branch, baseSha: existing.baseSha, adopted: true },
        }
      if (input.directory.startsWith(managedRoot(input.projectID) + path.sep)) return { directory: input.directory }
      const repository = yield* git.repo
        .discover(AbsolutePath.make(input.directory))
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (repository === undefined) return { directory: input.directory }

      // Adopt: the requested directory is itself a linked (non-main) worktree
      // of the repo — bind it so land/GC can see it, create nothing.
      const list = yield* git.worktree.list(repository).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (list !== undefined && list.length > 0 && String(repository.worktree) !== String(list[0].directory)) {
        const branch = (yield* git.history.branch(repository).pipe(Effect.catch(() => Effect.succeed(undefined)))) ?? "detached"
        const head = yield* git.history.head(repository)
        if (head === undefined) return { directory: input.directory }
        return {
          directory: input.directory,
          plan: { directory: input.directory, branch, baseSha: head, adopted: true },
        }
      }

      yield* git.worktree.prune(repository).pipe(Effect.catch(() => Effect.void))
      const baseSha = yield* git.history.head(repository)
      if (baseSha === undefined) return { directory: input.directory }
      const root = managedRoot(input.projectID)
      for (let attempt = 0; attempt < 8; attempt++) {
        const slug = Slug.create()
        const name = attempt === 0 ? slug : `${slug}-${attempt}`
        const directory = path.join(root, name)
        const branch = `prioricode/${name}`
        const exists = yield* fs.existsSafe(directory)
        if (exists) continue
        const created = yield* git.worktree
          .create({ repository, directory: AbsolutePath.make(directory), branch })
          .pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
        if (!created) continue
        return { directory, plan: { directory, branch, baseSha, adopted: false } }
      }
      return { directory: input.directory, failed: true as const }
    })

    const observe = (input: ProvisionInput, result: ProvisionResult) => {
      if (result.plan !== undefined)
        return Effect.logInfo("session isolated on its own branch", {
          sessionID: input.sessionID,
          branch: result.plan.branch,
          adopted: result.plan.adopted,
        }).pipe(Effect.as(result))
      if (result.failed === true)
        return Effect.logWarning("worktree provisioning exhausted; session stays on the shared checkout", {
          sessionID: input.sessionID,
        }).pipe(Effect.as(result))
      return Effect.succeed(result)
    }

    const provisionSafe = (input: ProvisionInput) =>
      provision(input).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("worktree provisioning failed; session stays on the shared checkout", {
            sessionID: input.sessionID,
            cause,
          }).pipe(Effect.as({ directory: input.directory })),
        ),
        Effect.flatMap((result) => observe(input, result)),
      )

    const bindSafe = (input: BindInput) => bind(input).pipe(Effect.catch(() => Effect.void))

    return Service.of({ provision: provisionSafe, bind: bindSafe, binding, setStatus })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Git.node, FSUtil.node, AppProcess.node],
})
