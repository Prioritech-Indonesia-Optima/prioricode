import { describe, expect } from "bun:test"
import path from "path"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Database } from "@prioricode/core/database/database"
import { ProjectV2 } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { FSUtil } from "@prioricode/core/fs-util"
import { SessionID } from "@/session/schema"
import { Coordination } from "@/session/coordination"
import { FileCollision } from "@/tool/file-collision"
import { requireInstance, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([FSUtil.node, Database.node, Coordination.node, FileCollision.node])),
)

const self = SessionID.make("ses_fc_self")
const peer = SessionID.make("ses_fc_peer")

// Ensure the instance's project row exists so claim FKs hold, without failing if
// the instance store already created it.
const ensureProject = Effect.fn("FileCollisionTest.ensureProject")(function* (
  projectID: ProjectV2.ID,
  directory: string,
) {
  const { db } = yield* Database.Service
  const existing = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get().pipe(Effect.orDie)
  if (existing) return
  yield* db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make(directory), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
})

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

  it.instance("attributes a change to a peer that has the file claimed", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* requireInstance
      const collision = yield* FileCollision.Service
      const fs = yield* FSUtil.Service
      const coordination = yield* Coordination.Service
      const projectID = instance.project.id
      yield* ensureProject(projectID, test.directory)
      const filepath = path.join(test.directory, "shared.txt")
      yield* fs.writeWithDirs(filepath, "v1")
      yield* collision.record(filepath, self)
      yield* coordination.post({ projectID, kind: "claim", fromSession: peer, body: filepath })
      yield* fs.writeWithDirs(filepath, "v2-changed")
      const notice = yield* collision.check(filepath, self, projectID)
      expect(notice).toContain("changed since you last read it")
      expect(notice).toContain(peer)
    }),
  )

  it.instance("does not attribute a change to the caller's own claim", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* requireInstance
      const collision = yield* FileCollision.Service
      const fs = yield* FSUtil.Service
      const coordination = yield* Coordination.Service
      const projectID = instance.project.id
      yield* ensureProject(projectID, test.directory)
      const filepath = path.join(test.directory, "mine.txt")
      yield* fs.writeWithDirs(filepath, "v1")
      yield* collision.record(filepath, self)
      yield* coordination.post({ projectID, kind: "claim", fromSession: self, body: filepath })
      yield* fs.writeWithDirs(filepath, "v2-changed")
      const notice = yield* collision.check(filepath, self, projectID)
      expect(notice).toContain("changed since you last read it")
      expect(notice).not.toContain(self)
    }),
  )
})
