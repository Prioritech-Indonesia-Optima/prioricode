import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Option } from "effect"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Database } from "@prioricode/core/database/database"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { FileTouch } from "@prioricode/core/file-touch"
import { FSUtil } from "@prioricode/core/fs-util"
import { Watcher } from "@prioricode/core/filesystem/watcher"
import { EventBridge } from "@/event-v2-bridge"
import { FileTouchWatcher } from "@/session/file-touch-watcher"
import { requireInstance, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([FSUtil.node, Database.node, FileTouch.node, EventBridge.node, FileTouchWatcher.node]),
  ),
)

const setup = Effect.gen(function* () {
  const test = yield* TestInstance
  const instance = yield* requireInstance
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: instance.project.id, worktree: AbsolutePath.make(test.directory), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* (yield* FileTouchWatcher.Service).init()
  return {
    fs: yield* FSUtil.Service,
    events: yield* EventBridge.Service,
    touches: yield* FileTouch.Service,
    projectID: instance.project.id,
    test,
  }
})

const fingerprintOf = (info: { mtime: Option.Option<Date>; size: unknown }) => ({
  mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
  size: Number(info.size),
})

describe("FileTouchWatcher", () => {
  it.instance("records an out-of-band change as external", () =>
    Effect.gen(function* () {
      const { fs, events, touches, projectID, test } = yield* setup
      const filepath = path.join(test.directory, "editor-edit.txt")
      yield* fs.writeWithDirs(filepath, "user typed this")
      yield* events.publish(Watcher.Event.Updated, { file: filepath, event: "change" })

      const found = yield* touches.lookup({ projectID, paths: [filepath] })
      expect(found).toHaveLength(1)
      expect(found[0]?.sessionID).toBeUndefined()
      expect(found[0]?.op).toBe("external")
      expect(found[0]?.fingerprint.size).toBe("user typed this".length)
    }),
  )

  it.instance("drops the echo of a recorded tool write instead of clobbering it", () =>
    Effect.gen(function* () {
      const { fs, events, touches, projectID, test } = yield* setup
      const filepath = path.join(test.directory, "tool-write.txt")
      yield* fs.writeWithDirs(filepath, "written by a session")
      const info = yield* fs.stat(filepath)
      yield* touches.record({
        projectID,
        path: filepath,
        op: "modify",
        sessionID: "ses_writer",
        fingerprint: fingerprintOf(info),
      })

      yield* events.publish(Watcher.Event.Updated, { file: filepath, event: "change" })
      const found = yield* touches.lookup({ projectID, paths: [filepath] })
      expect(found[0]?.sessionID).toBe("ses_writer")
      expect(found[0]?.op).toBe("modify")
    }),
  )

  it.instance("attributes deletion of a tracked file and ignores untracked deletions", () =>
    Effect.gen(function* () {
      const { fs, events, touches, projectID, test } = yield* setup
      const tracked = path.join(test.directory, "tracked.txt")
      const untracked = path.join(test.directory, "untracked.txt")
      yield* fs.writeWithDirs(tracked, "x")
      yield* touches.record({
        projectID,
        path: tracked,
        op: "create",
        sessionID: "ses_writer",
        fingerprint: { mtimeMs: 1, size: 1 },
      })

      yield* events.publish(Watcher.Event.Updated, { file: tracked, event: "unlink" })
      yield* events.publish(Watcher.Event.Updated, { file: untracked, event: "unlink" })

      const found = yield* touches.lookup({ projectID, paths: [tracked, untracked] })
      expect(found).toHaveLength(1)
      expect(found[0]?.path).toBe(tracked)
      expect(found[0]?.op).toBe("external-delete")
      expect(found[0]?.sessionID).toBeUndefined()
    }),
  )

  it.instance("ignores paths outside the worktree and .git internals", () =>
    Effect.gen(function* () {
      const { events, touches, projectID, test } = yield* setup
      yield* events.publish(Watcher.Event.Updated, {
        file: path.join(test.directory, ".git", "COMMIT_EDITMSG"),
        event: "change",
      })
      yield* events.publish(Watcher.Event.Updated, { file: "/somewhere/else/file.txt", event: "change" })

      const found = yield* touches.recent({ projectID, withinMs: 60_000, limit: 10 })
      expect(found).toEqual([])
    }),
  )
})
