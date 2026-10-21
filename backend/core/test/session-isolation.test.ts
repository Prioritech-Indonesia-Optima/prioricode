import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@prioricode/core/database/database"
import { Global } from "@prioricode/core/global"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionIsolation } from "@prioricode/core/session/isolation"
import { SessionSchema } from "@prioricode/core/session/schema"
import { SessionTable } from "@prioricode/core/session/sql"
import { SessionWorktreeTable } from "@prioricode/core/session/worktree.sql"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// Redirect the product data directory so managed worktrees and the sqlite file
// used by this file never touch the real user data paths.
const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "prioricode-iso-data-"))
Global.Path.data = dataHome

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionIsolation.node])))

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

const withRepo = Effect.fnUntraced(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  )
  yield* Effect.promise(() => initRepo(root.path))
  return root.path
})

const seedRows = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
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
      slug: "iso",
      directory: "/project",
      title: "iso",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
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

describe("SessionIsolation", () => {
  it.live("passes through when disabled", () =>
    Effect.gen(function* () {
      const repo = yield* withRepo()
      const iso = yield* SessionIsolation.Service
      const result = yield* iso.provision({
        projectID: Project.ID.global,
        sessionID: SessionSchema.ID.create(),
        directory: repo,
        vcs: "git",
        enabled: false,
      })
      expect(result.directory).toBe(repo)
      expect(result.plan).toBeUndefined()
    }),
  )

  it.live("passes through for non-git and for children", () =>
    Effect.gen(function* () {
      const iso = yield* SessionIsolation.Service
      const plain = yield* Effect.promise(() => fs.promises.realpath(fs.mkdtempSync(path.join(os.tmpdir(), "plain-"))))
      const outside = yield* iso.provision({
        projectID: Project.ID.global,
        sessionID: SessionSchema.ID.create(),
        directory: plain,
        vcs: "git",
        enabled: true,
      })
      expect(outside.plan).toBeUndefined()

      const repo = yield* withRepo()
      const child = yield* iso.provision({
        projectID: Project.ID.global,
        sessionID: SessionSchema.ID.create(),
        directory: repo,
        vcs: "git",
        parentID: SessionSchema.ID.make("ses_parent"),
        enabled: true,
      })
      expect(child.plan).toBeUndefined()
      expect(child.directory).toBe(repo)
    }),
  )

  it.live("provisions a branch-backed worktree and binds after creation", () =>
    Effect.gen(function* () {
      const repo = yield* withRepo()
      const iso = yield* SessionIsolation.Service
      const sessionID = SessionSchema.ID.create()
      const head = (yield* Effect.promise(() => $`git rev-parse HEAD`.cwd(repo).text())).trim()

      const result = yield* iso.provision({
        projectID: Project.ID.global,
        sessionID,
        directory: repo,
        vcs: "git",
        enabled: true,
      })
      const plan = result.plan
      expect(plan).toBeDefined()
      expect(plan?.adopted).toBe(false)
      expect(plan?.baseSha).toBe(head)
      expect(result.directory).toStartWith(path.join(dataHome, "worktree"))
      expect(plan?.branch.startsWith("prioricode/")).toBe(true)
      // Files land synchronously via `worktree add` checkout.
      expect(fs.existsSync(path.join(result.directory, "README.md"))).toBe(true)
      const branch = (yield* Effect.promise(() => $`git branch --show-current`.cwd(result.directory).text())).trim()
      expect(branch).toBe(plan?.branch ?? "")

      yield* seedRows(sessionID)
      yield* iso.bind({ sessionID, projectID: Project.ID.global, plan: plan! })
      const row = yield* rowFor(sessionID)
      expect(row?.status).toBe("active")
      expect(row?.branch ?? "").toBe(plan?.branch ?? "")
    }),
  )

  it.live("adopts a directory that is already a linked worktree", () =>
    Effect.gen(function* () {
      const repo = yield* withRepo()
      const linked = `${repo}-linked`
      yield* Effect.promise(() => $`git worktree add ${linked} -b feature/x`.cwd(repo).quiet())
      const iso = yield* SessionIsolation.Service
      const sessionID = SessionSchema.ID.create()
      const result = yield* iso.provision({
        projectID: Project.ID.global,
        sessionID,
        directory: linked,
        vcs: "git",
        enabled: true,
      })
      expect(result.directory).toBe(linked)
      expect(result.plan?.adopted).toBe(true)
      expect(result.plan?.branch).toBe("feature/x")

      yield* seedRows(sessionID)
      yield* iso.bind({ sessionID, projectID: Project.ID.global, plan: result.plan! })
      const row = yield* rowFor(sessionID)
      expect(row?.status).toBe("active")
      expect(row?.branch).toBe("feature/x")
    }),
  )

  it.live("re-entry keeps the first decision", () =>
    Effect.gen(function* () {
      const repo = yield* withRepo()
      const iso = yield* SessionIsolation.Service
      const sessionID = SessionSchema.ID.create()
      const first = yield* iso.provision({
        projectID: Project.ID.global,
        sessionID,
        directory: repo,
        vcs: "git",
        enabled: true,
      })
      yield* seedRows(sessionID)
      yield* iso.bind({ sessionID, projectID: Project.ID.global, plan: first.plan! })
      const again = yield* iso.provision({
        projectID: Project.ID.global,
        sessionID,
        directory: repo,
        vcs: "git",
        enabled: true,
      })
      expect(again.directory).toBe(first.directory)
      expect(again.plan?.adopted).toBe(true)
    }),
  )

  it.live("environment flag overrides config", () =>
    Effect.gen(function* () {
      const repo = yield* withRepo()
      const iso = yield* SessionIsolation.Service
      process.env["PRIORICODE_WORKTREE_ISOLATE"] = "0"
      const off = yield* iso.provision({
        projectID: Project.ID.global,
        sessionID: SessionSchema.ID.create(),
        directory: repo,
        vcs: "git",
        enabled: true,
      })
      expect(off.plan).toBeUndefined()
      process.env["PRIORICODE_WORKTREE_ISOLATE"] = "1"
      const forced = yield* iso.provision({
        projectID: Project.ID.global,
        sessionID: SessionSchema.ID.create(),
        directory: repo,
        vcs: "git",
        enabled: false,
      })
      expect(forced.plan?.adopted).toBe(false)
      delete process.env["PRIORICODE_WORKTREE_ISOLATE"]
      const kill = process.env["PRIORICODE_DISABLE_WORKTREE_ISOLATE"]
      process.env["PRIORICODE_DISABLE_WORKTREE_ISOLATE"] = "1"
      const killed = yield* iso.provision({
        projectID: Project.ID.global,
        sessionID: SessionSchema.ID.create(),
        directory: repo,
        vcs: "git",
        enabled: true,
      })
      expect(killed.plan).toBeUndefined()
      if (kill === undefined) delete process.env["PRIORICODE_DISABLE_WORKTREE_ISOLATE"]
      else process.env["PRIORICODE_DISABLE_WORKTREE_ISOLATE"] = kill
    }),
  )

  it.live(
    "setup command flips booting to active",
    () =>
      Effect.gen(function* () {
        const repo = yield* withRepo()
        const iso = yield* SessionIsolation.Service
        const sessionID = SessionSchema.ID.create()
        const marker = path.join(repo, "setup-ran")
        const result = yield* iso.provision({
          projectID: Project.ID.global,
          sessionID,
          directory: repo,
          vcs: "git",
          enabled: true,
        })
        yield* seedRows(sessionID)
        yield* iso.bind({
          sessionID,
          projectID: Project.ID.global,
          plan: result.plan!,
          setupCommand: `touch ${marker}`,
        })
        const row = yield* rowFor(sessionID)
        expect(row).toBeDefined()
        const wait: (status: string | undefined) => Effect.Effect<string | undefined, never, Database.Service> =
          Effect.fnUntraced(function* (status: string | undefined) {
            if (status !== "booting") return status
            yield* Effect.sleep("25 millis")
            return yield* wait((yield* rowFor(sessionID))?.status)
          })
        const settled = yield* wait(row?.status).pipe(Effect.timeout("10 seconds"))
        expect(settled).toBe("active")
        expect(fs.existsSync(marker)).toBe(true)
      }),
    30_000,
  )
})
