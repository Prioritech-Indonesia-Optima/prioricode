import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Database } from "@prioricode/core/database/database"
import { Global } from "@prioricode/core/global"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionGc } from "@prioricode/core/session/gc"
import { managedRoot } from "@prioricode/core/session/isolation"
import { SessionSchema } from "@prioricode/core/session/schema"
import { SessionTable } from "@prioricode/core/session/sql"
import { SessionWorktreeTable, type SessionWorktreeStatus } from "@prioricode/core/session/worktree.sql"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "prioricode-gc-data-"))
Global.Path.data = dataHome

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionGc.node])))

const projectID = Project.ID.global

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

const repo = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  )
  yield* Effect.promise(() => initRepo(root.path))
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make(root.path), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  return root.path
})

const headSha = (directory: string) => Effect.promise(async () => (await $`git rev-parse HEAD`.cwd(directory).text()).trim())

const addTree = Effect.fnUntraced(function* (directory: string, where: string, branch: string, commit?: string) {
  yield* Effect.promise(async () => {
    await $`git worktree add ${where} -b ${branch}`.cwd(directory).quiet()
    if (commit !== undefined) {
      await fs.promises.writeFile(path.join(where, commit), "work\n")
      await $`git add ${commit}`.cwd(where).quiet()
      await $`git commit -m ${commit}`.cwd(where).quiet()
    }
  })
  return where
})

const bind = Effect.fnUntraced(function* (
  sessionID: string,
  directory: string,
  branch: string,
  baseSha: string,
  status: SessionWorktreeStatus,
) {
  const id = SessionSchema.ID.make(sessionID)
  const { db } = yield* Database.Service
  yield* db
    .insert(SessionTable)
    .values({
      id,
      project_id: projectID,
      slug: sessionID,
      directory,
      title: sessionID,
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionWorktreeTable)
    .values({ session_id: id, project_id: projectID, directory, branch, base_sha: baseSha, status })
    .run()
    .pipe(Effect.orDie)
})

const refExists = (directory: string, branch: string) =>
  Effect.promise(async () => (await $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(directory).nothrow()).exitCode === 0)

describe("SessionGc", () => {
  it.live("removes landed, keeps live, force-retires discarded; never touches foreign", () =>
    Effect.gen(function* () {
      const directory = yield* repo
      const base = yield* headSha(directory)
      const root = managedRoot(projectID)

      // landed: merged into main, ledger says landed -> retire tree + branch
      const landed = yield* addTree(directory, path.join(root, "alpha"), "prioricode/alpha", "alpha.txt")
      yield* Effect.promise(() => $`git merge --no-ff -m land prioricode/alpha`.cwd(directory).quiet())
      yield* bind("ses_gc_landed", landed, "prioricode/alpha", base, "landed")

      // live session still working: kept regardless
      const live = yield* addTree(directory, path.join(root, "bravo"), "prioricode/bravo", "bravo.txt")
      yield* bind("ses_gc_live", live, "prioricode/bravo", base, "active")

      // discarded with uncommitted junk: force-retired (user intent)
      const junk = yield* addTree(directory, path.join(root, "charlie"), "prioricode/charlie")
      yield* Effect.promise(() => fs.promises.writeFile(path.join(junk, "dirty.txt"), "junk\n"))
      yield* bind("ses_gc_discarded", junk, "prioricode/charlie", base, "discarded")

      // orphan registered tree WITHOUT unique commits: removable
      const orphan = yield* addTree(directory, path.join(root, "delta"), "prioricode/delta")

      // foreign tree outside the managed root: reported only, never touched
      const foreign = yield* addTree(directory, `${directory}-foreign`, "feature/handmade")

      const gc = yield* SessionGc.Service
      const report = yield* gc.gc({ projectID, directory, foreign: true })

      expect(report.removed.map((item) => item.branch)).toContain("prioricode/alpha")
      expect(report.removed.map((item) => item.branch)).toContain("prioricode/charlie")
      expect(report.removed.map((item) => item.branch)).toContain("prioricode/delta")
      expect(fs.existsSync(landed)).toBe(false)
      expect(fs.existsSync(junk)).toBe(false)
      expect(fs.existsSync(orphan)).toBe(false)
      expect(yield* refExists(directory, "prioricode/alpha")).toBe(false)
      // discarded force-retire still refuses the un-merged branch delete (-d only)
      expect(fs.existsSync(live)).toBe(true)
      expect(report.kept.map((item) => item.directory)).toContain(live)
      expect(fs.existsSync(foreign)).toBe(true)
      expect(report.foreign.map((item) => item.directory)).toContain(foreign)
      // foreign branch is intact
      expect(yield* refExists(directory, "feature/handmade")).toBe(true)
    }),
    30_000,
  )

  it.live("keeps an orphan whose branch holds unique work", () =>
    Effect.gen(function* () {
      const directory = yield* repo
      const root = managedRoot(projectID)
      const risky = yield* addTree(directory, path.join(root, "echo"), "prioricode/echo", "keepme.txt")
      const gc = yield* SessionGc.Service
      const report = yield* gc.gc({ projectID, directory })
      expect(fs.existsSync(risky)).toBe(true)
      expect(report.kept.some((item) => item.directory === risky)).toBe(true)
      expect(report.removed.map((item) => item.branch)).not.toContain("prioricode/echo")
    }),
  )

  it.live("cleans refs for vanished landed trees after a manual rm", () =>
    Effect.gen(function* () {
      const directory = yield* repo
      const base = yield* headSha(directory)
      const root = managedRoot(projectID)
      const tree = yield* addTree(directory, path.join(root, "foxtrot"), "prioricode/foxtrot")
      yield* bind("ses_gc_vanished", tree, "prioricode/foxtrot", base, "landed")
      yield* Effect.promise(() => fs.promises.rm(tree, { recursive: true, force: true }))

      const gc = yield* SessionGc.Service
      yield* gc.gc({ projectID, directory })
      expect(yield* refExists(directory, "prioricode/foxtrot")).toBe(false)
    }),
  )

  it.live("never deletes an unmerged landed branch even if status lies", () =>
    Effect.gen(function* () {
      const directory = yield* repo
      const base = yield* headSha(directory)
      const root = managedRoot(projectID)
      // landed status but the branch was never merged: ancestor check must save it
      const tree = yield* addTree(directory, path.join(root, "golf"), "prioricode/golf", "unique.txt")
      yield* bind("ses_gc_lie", tree, "prioricode/golf", base, "landed")

      const gc = yield* SessionGc.Service
      const report = yield* gc.gc({ projectID, directory })
      expect(fs.existsSync(tree)).toBe(true)
      expect(report.kept.some((item) => item.reason.includes("ancestor"))).toBe(true)
    }),
  )
})
