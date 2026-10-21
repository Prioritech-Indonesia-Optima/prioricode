import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Option } from "effect"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Database } from "@prioricode/core/database/database"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { FileTouch } from "@prioricode/core/file-touch"
import { FSUtil } from "@prioricode/core/fs-util"
import { FileAttribution } from "@/tool/file-attribution"
import { requireInstance, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([FSUtil.node, Database.node, FileTouch.node, FileAttribution.node])),
)

const self = "ses_attribution_self"
const peer = "ses_attribution_peer"

const fingerprintOf = (info: { mtime: Option.Option<Date>; size: unknown }) => ({
  mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
  size: Number(info.size),
})

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
  return {
    fs: yield* FSUtil.Service,
    touches: yield* FileTouch.Service,
    attribution: yield* FileAttribution.Service,
    projectID: instance.project.id,
    test,
  }
})

const classify = Effect.fnUntraced(function* (
  attribution: FileAttribution.Interface,
  projectID: Project.ID,
  base: string,
  paths: string[],
) {
  return yield* attribution.classify({ projectID, sessionID: self, base, paths })
})

describe("FileAttribution", () => {
  it.instance("classifies a session's own matching row as self and a peer's as peer", () =>
    Effect.gen(function* () {
      const { fs, touches, attribution, projectID, test } = yield* setup
      const mine = path.join(test.directory, "mine.txt")
      const theirs = path.join(test.directory, "theirs.txt")
      yield* fs.writeWithDirs(mine, "mine")
      yield* fs.writeWithDirs(theirs, "theirs")
      const mineInfo = yield* fs.stat(mine)
      const theirsInfo = yield* fs.stat(theirs)
      yield* touches.record({
        projectID,
        path: mine,
        op: "modify",
        sessionID: self,
        fingerprint: fingerprintOf(mineInfo),
      })
      yield* touches.record({
        projectID,
        path: theirs,
        op: "modify",
        sessionID: peer,
        fingerprint: fingerprintOf(theirsInfo),
      })

      const result = yield* classify(attribution, projectID, test.directory, ["mine.txt", "theirs.txt"])
      expect(result.map((item) => item.status)).toEqual(["self", "peer"])
      expect(result[1]?.status === "peer" && result[1].touch.sessionID).toBe(peer)
    }),
  )

  it.instance("a live file that drifted from the row is unrecorded, carrying the stale row", () =>
    Effect.gen(function* () {
      const { fs, touches, attribution, projectID, test } = yield* setup
      const filepath = path.join(test.directory, "drift.txt")
      yield* fs.writeWithDirs(filepath, "recorded")
      const info = yield* fs.stat(filepath)
      yield* touches.record({
        projectID,
        path: filepath,
        op: "modify",
        sessionID: peer,
        fingerprint: fingerprintOf(info),
      })
      yield* fs.writeWithDirs(filepath, "changed by someone else entirely")

      const [result] = yield* classify(attribution, projectID, test.directory, [filepath])
      expect(result?.status).toBe("unrecorded")
      expect(result?.status === "unrecorded" && result.staleTouch !== undefined).toBe(true)
    }),
  )

  it.instance("no row at all is unrecorded without stale context", () =>
    Effect.gen(function* () {
      const { fs, attribution, projectID, test } = yield* setup
      const filepath = path.join(test.directory, "never.txt")
      yield* fs.writeWithDirs(filepath, "content")

      const [result] = yield* classify(attribution, projectID, test.directory, [filepath])
      expect(result?.status).toBe("unrecorded")
      expect(result?.status === "unrecorded" && result.staleTouch === undefined).toBe(true)
    }),
  )

  it.instance(
    "an external row matching live state is external; a recorded peer delete of a gone file stays authoritative",
    () =>
      Effect.gen(function* () {
        const { fs, touches, attribution, projectID, test } = yield* setup
        const edited = path.join(test.directory, "editor.txt")
        yield* fs.writeWithDirs(edited, "user typed")
        const info = yield* fs.stat(edited)
        yield* touches.record({ projectID, path: edited, op: "external", fingerprint: fingerprintOf(info) })

        const gone = path.join(test.directory, "gone.txt")
        yield* touches.record({
          projectID,
          path: gone,
          op: "delete",
          sessionID: peer,
          fingerprint: { mtimeMs: 0, size: 0 },
        })

        const result = yield* classify(attribution, projectID, test.directory, [edited, gone])
        expect(result[0]?.status).toBe("external")
        // sessionID set + {0,0} fingerprint: a peer delete is still that peer's fact.
        expect(result[1]?.status === "peer" && result[1].touch.op).toBe("delete")
      }),
  )
  it.instance(
    "finds a sibling worktree's touch by repo-relative path when the fingerprint matches", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* requireInstance
      const fs = yield* FSUtil.Service
      const touches = yield* FileTouch.Service
      const attribution = yield* FileAttribution.Service
      // The live file in THIS checkout:
      const local = path.join(test.directory, "shared.txt")
      yield* fs.writeWithDirs(local, "content both trees share\n")
      const info = yield* fs.stat(local).pipe(Effect.orDie)
      // The peer recorded its write in ITS OWN worktree path (different root,
      // same repo-relative path, same fingerprint):
      yield* touches.record({
        projectID: instance.project.id,
        path: path.join(test.directory, "..", "wt-peer", "shared.txt"),
        relativePath: "shared.txt",
        op: "modify",
        sessionID: peer,
        fingerprint: {
          mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
          size: Number(info.size),
        },
      })

      const [result] = yield* classify(attribution, instance.project.id, test.directory, [local])
      expect(result?.status).toBe("peer")
      expect(result?.status === "peer" && result.touch.sessionID).toBe(peer)
    }),
  )

  it.instance(
    "does not claim ownership across worktrees when content drifted", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* requireInstance
      const fs = yield* FSUtil.Service
      const touches = yield* FileTouch.Service
      const attribution = yield* FileAttribution.Service
      const local = path.join(test.directory, "drifted.txt")
      yield* fs.writeWithDirs(local, "mine now\n")
      yield* touches.record({
        projectID: instance.project.id,
        path: path.join(test.directory, "..", "wt-peer", "drifted.txt"),
        relativePath: "drifted.txt",
        op: "modify",
        sessionID: peer,
        fingerprint: { mtimeMs: 5, size: 999 },
      })

      const [result] = yield* classify(attribution, instance.project.id, test.directory, [local])
      expect(result?.status).toBe("unrecorded")
    }),
  )
})
