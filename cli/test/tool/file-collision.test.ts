import { describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { FSUtil } from "@prioricode/core/fs-util"
import { SessionID } from "@/session/schema"
import { FileCollision } from "@/tool/file-collision"
import { requireInstance, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([FSUtil.node, FileCollision.node])))

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
})
