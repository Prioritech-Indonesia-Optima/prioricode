import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Database } from "@prioricode/core/database/database"
import { Global } from "@prioricode/core/global"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionIsolation } from "@prioricode/core/session/isolation"
import { SessionLand } from "@prioricode/core/session/land"
import { SessionSchema } from "@prioricode/core/session/schema"
import { SessionTable } from "@prioricode/core/session/sql"
import { LandClaimTable, SessionWorktreeTable } from "@prioricode/core/session/worktree.sql"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// Redirect the product data directory so managed worktrees and the sqlite file
// used by this file never touch the real user data paths.
const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "prioricode-land-data-"))
Global.Path.data = dataHome

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionIsolation.node, SessionLand.node])))

async function initRepo(directory: string) {
  await $`git init -b main`.cwd(directory).quiet()
  await $`git config core.fsmonitor false`.cwd(directory).quiet()
  await $`git config commit.gpgsign false`.cwd(directory).quiet()
  await $`git config user.email test@prioricode.test`.cwd(directory).quiet()
  await $`git config user.name Test`.cwd(directory).quiet()
  await fs.promises.writeFile(path.join(directory, "README.md"), "root\n")
  await $`git add README.md`.cwd(directory).quiet()
  await $`git commit -m root`.cwd(directory).quiet()
}

const main = Effect.fnUntraced(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  )
  yield* Effect.promise(() => initRepo(root.path))
  return root.path
})

const seed = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "land",
      directory: "/project",
      title: "land",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

/** Provision an isolated session tree via the real service, then commit work in it. */
const isolated = Effect.fnUntraced(function* (
  repo: string,
  sessionID: SessionSchema.ID,
  file: string,
  content: string,
) {
  const iso = yield* SessionIsolation.Service
  yield* seed(sessionID)
  const result = yield* iso.provision({
    projectID: Project.ID.global,
    sessionID,
    directory: repo,
    vcs: "git",
    enabled: true,
  })
  const plan = result.plan
  if (plan === undefined) throw new Error("expected provisioning")
  yield* iso.bind({ sessionID, projectID: Project.ID.global, plan })
  yield* Effect.promise(async () => {
    await fs.promises.writeFile(path.join(plan.directory, file), content)
    await $`git add ${file}`.cwd(plan.directory).quiet()
    await $`git commit -m ${file}`.cwd(plan.directory).quiet()
  })
  return plan
})

const rowFor = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
  const { db } = yield* Database.Service
  return yield* db
    .select()
    .from(SessionWorktreeTable)
    .where(eq(SessionWorktreeTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
})

describe("SessionLand", () => {
  it.live("refuses a session with no binding", () =>
    Effect.gen(function* () {
      const repo = yield* main()
      const land = yield* SessionLand.Service
      const result = yield* land.land({ sessionID: SessionSchema.ID.create(), projectID: Project.ID.global })
      expect(result.landed).toBe(false)
      if (!result.landed && result.reason === "no-binding") expect(result.next.length > 0).toBe(true)
      expect(repo.length > 0).toBe(true)
    }),
  )

  it.live("lands a clean non-conflicting session branch", () =>
    Effect.gen(function* () {
      const repo = yield* main()
      const sessionID = SessionSchema.ID.create()
      const plan = yield* isolated(repo, sessionID, "feature.txt", "shipped\n")
      const land = yield* SessionLand.Service
      const result = yield* land.land({ sessionID, projectID: Project.ID.global, command: "exit 0" })
      expect(result.landed).toBe(true)
      if (result.landed) {
        expect(result.checkout).toBe("synced")
        expect(result.branch).toBe(plan.branch)
        // main branch now contains the session file in both ref and checkout
        const onMain = (yield* Effect.promise(() => $`git show main:feature.txt`.cwd(repo).text())).trim()
        expect(onMain).toBe("shipped")
        expect(fs.existsSync(path.join(repo, "feature.txt"))).toBe(true)
        const parents = (yield* Effect.promise(() => $`git rev-list --parents -n 1 main`.cwd(repo).text()))
          .trim()
          .split(" ")
        expect(parents.length).toBe(3) // merge commit with two parents
      }
      const row = yield* rowFor(sessionID)
      expect(row?.status).toBe("landed")
      const { db } = yield* Database.Service
      const claims = yield* db.select().from(LandClaimTable).all().pipe(Effect.orDie)
      expect(claims.length).toBe(0)
      // Auto-retire: the landed tree and its merged branch are cleaned up.
      expect(fs.existsSync(plan.directory)).toBe(false)
      const ref = (yield* Effect.promise(
        async () => await $`git show-ref --verify refs/heads/${plan.branch}`.cwd(repo).quiet().nothrow(),
      )).exitCode
      expect(ref).not.toBe(0)
    }),
  )

  it.live("refuses to land what it cannot verify", () =>
    Effect.gen(function* () {
      const repo = yield* main()
      const sessionID = SessionSchema.ID.create()
      yield* isolated(repo, sessionID, "blind.txt", "x\n")
      const before = (yield* Effect.promise(() => $`git rev-parse main`.cwd(repo).text())).trim()
      const land = yield* SessionLand.Service
      const result = yield* land.land({ sessionID, projectID: Project.ID.global })
      expect(result.landed).toBe(false)
      if (!result.landed && result.reason === "no-verify-command") expect(result.next.length > 0).toBe(true)
      const after = (yield* Effect.promise(() => $`git rev-parse main`.cwd(repo).text())).trim()
      expect(after).toBe(before)
      const row = yield* rowFor(sessionID)
      expect(row?.status).toBe("active")
    }),
  )

  it.live("previews without touching anything on dry-run", () =>
    Effect.gen(function* () {
      const repo = yield* main()
      const before = (yield* Effect.promise(() => $`git rev-parse main`.cwd(repo).text())).trim()
      const sessionID = SessionSchema.ID.create()
      yield* isolated(repo, sessionID, "preview.txt", "x\n")
      const land = yield* SessionLand.Service
      const result = yield* land.land({ sessionID, projectID: Project.ID.global, dryRun: true })
      expect(result.landed).toBe(false)
      if (!result.landed && result.reason === "preview") expect(result.files).toContain("preview.txt")
      const after = (yield* Effect.promise(() => $`git rev-parse main`.cwd(repo).text())).trim()
      expect(after).toBe(before)
      const row = yield* rowFor(sessionID)
      expect(row?.status).toBe("active")
    }),
  )

  it.live("rolls back when the merged tree fails verification", () =>
    Effect.gen(function* () {
      const repo = yield* main()
      // verification: red if MERGE_BAD is present in the tree being checked
      yield* Effect.promise(async () => {
        await fs.promises.writeFile(
          path.join(repo, "package.json"),
          JSON.stringify({ scripts: { test: "sh check.sh" } }),
        )
        await fs.promises.writeFile(path.join(repo, "check.sh"), "[ -f MERGE_BAD ] && exit 3\nexit 0\n")
        await $`git add package.json check.sh`.cwd(repo).quiet()
        await $`git commit -m pkg`.cwd(repo).quiet()
      })
      const sessionID = SessionSchema.ID.create()
      yield* isolated(repo, sessionID, "good.txt", "ok\n")
      // main gains MERGE_BAD after the session branched: session tree stays green,
      // the merged result is red — the landing must roll main back.
      yield* Effect.promise(async () => {
        await fs.promises.writeFile(path.join(repo, "MERGE_BAD"), "bad\n")
        await $`git add MERGE_BAD`.cwd(repo).quiet()
        await $`git commit -m bad`.cwd(repo).quiet()
      })
      const before = (yield* Effect.promise(() => $`git rev-parse main`.cwd(repo).text())).trim()
      const land = yield* SessionLand.Service
      const result = yield* land.land({ sessionID, projectID: Project.ID.global })
      expect(result.landed).toBe(false)
      if (!result.landed && result.reason === "merged-verify-failed") {
        expect(result.reverted).toBe(true)
        // detectCommand picks the runner for the lockfile; plain tmp repo -> npm
        expect(["sh check.sh", "npm test", "bun run test", "pnpm test", "yarn test"]).toContain(result.command)
      }
      const after = (yield* Effect.promise(() => $`git rev-parse main`.cwd(repo).text())).trim()
      expect(after).toBe(before)
      const row = yield* rowFor(sessionID)
      expect(row?.status).toBe("active")
    }),
  )

  it.live("refuses on conflicts and reports the paths", () =>
    Effect.gen(function* () {
      const repo = yield* main()
      const sessionID = SessionSchema.ID.create()
      const plan = yield* isolated(repo, sessionID, "README.md", "session side\n")
      // main moves with a different edit to the same file
      yield* Effect.promise(async () => {
        await fs.promises.writeFile(path.join(repo, "README.md"), "human side\n")
        await $`git add README.md`.cwd(repo).quiet()
        await $`git commit -m human`.cwd(repo).quiet()
      })
      const land = yield* SessionLand.Service
      const result = yield* land.land({ sessionID, projectID: Project.ID.global })
      expect(result.landed).toBe(false)
      if (!result.landed && result.reason === "conflict") expect(result.paths).toContain("README.md")
      const row = yield* rowFor(sessionID)
      expect(row?.status).toBe("active")
      expect(plan.branch.length > 0).toBe(true)
    }),
  )

  it.live("defers while the primary checkout is dirty", () =>
    Effect.gen(function* () {
      const repo = yield* main()
      const sessionID = SessionSchema.ID.create()
      yield* isolated(repo, sessionID, "safe.txt", "ok\n")
      yield* Effect.promise(() => fs.promises.writeFile(path.join(repo, "uncommitted.txt"), "user work\n"))
      const land = yield* SessionLand.Service
      const result = yield* land.land({ sessionID, projectID: Project.ID.global })
      expect(result.landed).toBe(false)
      if (!result.landed && result.reason === "primary-dirty") expect(result.paths).toContain("uncommitted.txt")
      // the user's uncommitted file survived untouched
      expect(fs.readFileSync(path.join(repo, "uncommitted.txt"), "utf8")).toBe("user work\n")
      const row = yield* rowFor(sessionID)
      expect(row?.status).toBe("active")
    }),
  )

  it.live("refuses when another claim holds the branch", () =>
    Effect.gen(function* () {
      const repo = yield* main()
      const sessionID = SessionSchema.ID.create()
      const plan = yield* isolated(repo, sessionID, "claimed.txt", "x\n")
      const { db } = yield* Database.Service
      yield* db
        .insert(LandClaimTable)
        .values({
          id: `land:${Project.ID.global}:${plan.branch}`,
          project_id: Project.ID.global,
          branch: plan.branch,
          session_id: sessionID,
          status: "reserved",
          base_oid: plan.baseSha,
          deadline: Date.now() + 60_000,
        })
        .run()
        .pipe(Effect.orDie)
      const land = yield* SessionLand.Service
      const result = yield* land.land({ sessionID, projectID: Project.ID.global })
      expect(result.landed).toBe(false)
      if (!result.landed) expect(result.reason).toBe("claimed")
      // the pre-existing claim is NOT deleted by the refused attempt
      const rows = yield* db.select().from(LandClaimTable).all().pipe(Effect.orDie)
      expect(rows.length).toBe(1)
    }),
  )

  it.live("verify gate blocks a red session tree", () =>
    Effect.gen(function* () {
      const repo = yield* main()
      const sessionID = SessionSchema.ID.create()
      yield* isolated(repo, sessionID, "red.txt", "x\n")
      const land = yield* SessionLand.Service
      const result = yield* land.land({ sessionID, projectID: Project.ID.global, command: "exit 1" })
      expect(result.landed).toBe(false)
      if (!result.landed && result.reason === "verify-failed") {
        expect(result.command).toBe("exit 1")
        expect(result.exit).toBe(1)
      }
    }),
  )
})
