import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@prioricode/core/database/database"
import { FileTouch } from "@prioricode/core/file-touch"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, FileTouch.node])))

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
})

const touch = { mtimeMs: 1_000, size: 10 }

describe("FileTouch", () => {
  it.effect("records the last writer and looks it up by path", () =>
    Effect.gen(function* () {
      yield* setup
      const touches = yield* FileTouch.Service
      yield* touches.record({
        projectID: Project.ID.global,
        path: "/project/a.ts",
        op: "modify",
        sessionID: "ses_a",
        fingerprint: touch,
        provenance: { messageID: "msg_1", callID: "call_1", model: "provider/model-x" },
      })

      const found = yield* touches.lookup({
        projectID: Project.ID.global,
        paths: ["/project/a.ts", "/project/missing"],
      })
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({
        path: "/project/a.ts",
        sessionID: "ses_a",
        op: "modify",
        fingerprint: touch,
        provenance: { messageID: "msg_1", callID: "call_1", model: "provider/model-x" },
      })
    }),
  )

  it.effect("upsert keeps one row per path and overwrites with the latest writer", () =>
    Effect.gen(function* () {
      yield* setup
      const touches = yield* FileTouch.Service
      yield* touches.record({
        projectID: Project.ID.global,
        path: "/project/b.ts",
        op: "create",
        sessionID: "ses_a",
        fingerprint: touch,
      })
      yield* touches.record({
        projectID: Project.ID.global,
        path: "/project/b.ts",
        op: "delete",
        sessionID: "ses_b",
        fingerprint: { mtimeMs: 2_000, size: 0 },
        provenance: { messageID: "msg_2" },
      })

      const found = yield* touches.lookup({ projectID: Project.ID.global, paths: ["/project/b.ts"] })
      expect(found).toHaveLength(1)
      expect(found[0]?.sessionID).toBe("ses_b")
      expect(found[0]?.op).toBe("delete")
      // Overwrite drops the previous write's provenance too.
      expect(found[0]?.provenance).toEqual({ messageID: "msg_2" })
    }),
  )

  it.effect("records external changes without a session and clears stale provenance", () =>
    Effect.gen(function* () {
      yield* setup
      const touches = yield* FileTouch.Service
      yield* touches.record({
        projectID: Project.ID.global,
        path: "/project/c.ts",
        op: "modify",
        sessionID: "ses_a",
        fingerprint: touch,
        provenance: { messageID: "msg_1", model: "m" },
      })
      yield* touches.record({
        projectID: Project.ID.global,
        path: "/project/c.ts",
        op: "external",
        fingerprint: { mtimeMs: 3_000, size: 12 },
      })

      const found = yield* touches.lookup({ projectID: Project.ID.global, paths: ["/project/c.ts"] })
      expect(found[0]?.sessionID).toBeUndefined()
      expect(found[0]?.provenance).toBeUndefined()
      expect(found[0]?.op).toBe("external")
    }),
  )

  it.effect("recent returns newest-first within the window, capped and session-filtered", () =>
    Effect.gen(function* () {
      yield* setup
      const touches = yield* FileTouch.Service
      yield* touches.record({
        projectID: Project.ID.global,
        path: "/project/x.ts",
        op: "modify",
        sessionID: "ses_x",
        fingerprint: touch,
      })
      yield* touches.record({
        projectID: Project.ID.global,
        path: "/project/y.ts",
        op: "modify",
        sessionID: "ses_y",
        fingerprint: touch,
      })

      const all = yield* touches.recent({ projectID: Project.ID.global, withinMs: 60_000, limit: 10 })
      expect(all.map((item) => item.path).sort()).toEqual(["/project/x.ts", "/project/y.ts"])

      const one = yield* touches.recent({ projectID: Project.ID.global, withinMs: 60_000, limit: 1 })
      expect(one).toHaveLength(1)

      const filtered = yield* touches.recent({
        projectID: Project.ID.global,
        sessionIDs: ["ses_y"],
        withinMs: 60_000,
        limit: 10,
      })
      expect(filtered.map((item) => item.path)).toEqual(["/project/y.ts"])

      const stale = yield* touches.recent({ projectID: Project.ID.global, withinMs: -60_000, limit: 10 })
      expect(stale).toEqual([])
    }),
  )

  it.effect("kill switch turns recording into a no-op without failing the caller", () =>
    Effect.gen(function* () {
      yield* setup
      const touches = yield* FileTouch.Service
      process.env.PRIORICODE_DISABLE_FILE_TOUCH = "1"
      try {
        yield* touches.record({
          projectID: Project.ID.global,
          path: "/project/disabled.ts",
          op: "modify",
          sessionID: "ses_a",
          fingerprint: touch,
        })
      } finally {
        delete process.env.PRIORICODE_DISABLE_FILE_TOUCH
      }
      const found = yield* touches.lookup({ projectID: Project.ID.global, paths: ["/project/disabled.ts"] })
      expect(found).toEqual([])
    }),
  )
})

it.effect("stores the writer-supplied repo-relative form and answers lookupRelative", () =>
  Effect.gen(function* () {
    yield* setup
    const touches = yield* FileTouch.Service
    yield* touches.record({
      projectID: Project.ID.global,
      path: "/wt-b/sub/a.ts",
      relativePath: "sub/a.ts",
      op: "modify",
      sessionID: "ses_b",
      fingerprint: touch,
    })
    const byRel = yield* touches.lookupRelative({ projectID: Project.ID.global, paths: ["sub/a.ts"] })
    expect(byRel.map((item) => item.path)).toEqual(["/wt-b/sub/a.ts"])
    expect(byRel[0]?.relativePath).toBe("sub/a.ts")

    // Newest-first, capped; a same-relative sibling write from another worktree surfaces.
    yield* touches.record({
      projectID: Project.ID.global,
      path: "/wt-a/sub/a.ts",
      relativePath: "sub/a.ts",
      op: "create",
      sessionID: "ses_a",
      fingerprint: { mtimeMs: 2_000, size: 4 },
    })
    const both = yield* touches.lookupRelative({ projectID: Project.ID.global, paths: ["sub/a.ts"] })
    expect(both.map((item) => item.path)).toEqual(["/wt-a/sub/a.ts", "/wt-b/sub/a.ts"])

    const withoutB = yield* touches.lookupRelative({
      projectID: Project.ID.global,
      paths: ["sub/a.ts"],
      excludeSessionID: "ses_a",
    })
    expect(withoutB.map((item) => item.sessionID)).toEqual(["ses_b"])

    // NULL-relative rows (foreign paths) never answer a relative query.
    const foreign = yield* touches.lookupRelative({ projectID: Project.ID.global, paths: ["elsewhere.ts"] })
    expect(foreign).toEqual([])
  }),
)

it.effect("relativePath helper maps inside/outside roots correctly", () => {
  expect(FileTouch.relativePath("/repo/a", "/repo/a/x/y.ts")).toBe("x/y.ts")
  expect(FileTouch.relativePath("/repo/a", "/repo/a")).toBeUndefined()
  expect(FileTouch.relativePath("/repo/a", "/repo/b/x.ts")).toBeUndefined()
  expect(FileTouch.relativePath("/repo/a", "/repo/ab/x.ts")).toBeUndefined()
  return Effect.void
})
