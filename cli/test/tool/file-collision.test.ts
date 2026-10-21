import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Option } from "effect"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { FSUtil } from "@prioricode/core/fs-util"
import { SessionID } from "@/session/schema"
import { Database } from "@prioricode/core/database/database"
import { FileTouch } from "@prioricode/core/file-touch"
import { FileCollision } from "@/tool/file-collision"
import { requireInstance, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([FSUtil.node, Database.node, FileTouch.node, FileCollision.node])),
)

const self = SessionID.make("ses_fc_self")

describe("FileCollision", () => {
  it.instance("returns undefined when the file was never observed", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* requireInstance
      const collision = yield* FileCollision.Service
      const fs = yield* FSUtil.Service
      const filepath = path.join(test.directory, "never.txt")
      yield* fs.writeWithDirs(filepath, "content")
      expect(yield* collision.check(filepath, self, instance.project.id)).toBeUndefined()
    }),
  )

  it.instance("returns undefined when the file is unchanged since it was recorded", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* requireInstance
      const collision = yield* FileCollision.Service
      const fs = yield* FSUtil.Service
      const filepath = path.join(test.directory, "stable.txt")
      yield* fs.writeWithDirs(filepath, "stable content")
      yield* collision.record(filepath, self)
      expect(yield* collision.check(filepath, self, instance.project.id)).toBeUndefined()
    }),
  )

  it.instance("reports a change when the file was modified after being recorded", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* requireInstance
      const collision = yield* FileCollision.Service
      const fs = yield* FSUtil.Service
      const filepath = path.join(test.directory, "changed.txt")
      yield* fs.writeWithDirs(filepath, "original")
      yield* collision.record(filepath, self)
      yield* fs.writeWithDirs(filepath, "original-modified-longer")
      const notice = yield* collision.check(filepath, self, instance.project.id)
      expect(notice).toContain("changed since you last read it")
      expect(notice).toContain("sessions tool")
    }),
  )

  it.instance("reports deletion when the file was removed after being recorded", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* requireInstance
      const collision = yield* FileCollision.Service
      const fs = yield* FSUtil.Service
      const filepath = path.join(test.directory, "gone.txt")
      yield* fs.writeWithDirs(filepath, "here")
      yield* collision.record(filepath, self)
      yield* fs.remove(filepath)
      const notice = yield* collision.check(filepath, self, instance.project.id)
      expect(notice).toContain("no longer exists")
    }),
  )

  it.instance("names the peer session whose recorded write matches the current file state", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* requireInstance
      const collision = yield* FileCollision.Service
      const fs = yield* FSUtil.Service
      const touches = yield* FileTouch.Service
      const filepath = path.join(test.directory, "peer-work.txt")
      yield* fs.writeWithDirs(filepath, "mine")
      yield* collision.record(filepath, self)
      yield* fs.writeWithDirs(filepath, "rewritten by a sibling")
      const info = yield* fs.stat(filepath).pipe(Effect.orDie)
      yield* touches.record({
        projectID: instance.project.id,
        path: filepath,
        op: "modify",
        sessionID: "ses_fc_writer",
        fingerprint: {
          mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
          size: Number(info.size),
        },
      })

      const notice = yield* collision.check(filepath, self, instance.project.id)
      expect(notice).toContain("last written by session ses_fc_writer")
      expect(notice).toContain("query the writer via the sessions tool")
    }),
  )

  it.instance("names an out-of-band writer when the ledger recorded the change as external", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* requireInstance
      const collision = yield* FileCollision.Service
      const fs = yield* FSUtil.Service
      const touches = yield* FileTouch.Service
      const filepath = path.join(test.directory, "editor.txt")
      yield* fs.writeWithDirs(filepath, "mine")
      yield* collision.record(filepath, self)
      yield* fs.writeWithDirs(filepath, "typed by the user in an editor")
      const info = yield* fs.stat(filepath).pipe(Effect.orDie)
      yield* touches.record({
        projectID: instance.project.id,
        path: filepath,
        op: "external",
        fingerprint: {
          mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
          size: Number(info.size),
        },
      })

      const notice = yield* collision.check(filepath, self, instance.project.id)
      expect(notice).toContain("changed outside PrioriCode tools")
    }),
  )
})
