import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Database } from "@prioricode/core/database/database"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { Coordination } from "@/session/coordination"
import { FileAttribution } from "@/tool/file-attribution"
import { FileTouch } from "@prioricode/core/file-touch"
import { FSUtil } from "@prioricode/core/fs-util"
import { TestInstance } from "../fixture/fixture"
import { Option } from "effect"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "@/session/schema"
import { SessionsTool } from "@/tool/sessions"
import { NotFoundError } from "@/storage/storage"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { pollWithTimeout, testEffect } from "../lib/effect"

const projectID = Project.ID.global
const selfID = SessionID.make("ses_bc_self")
const activeID = SessionID.make("ses_bc_active")
const staleID = SessionID.make("ses_bc_stale")

const now = Date.now()
const info = (id: SessionID, title: string, updated: number) =>
  ({
    id,
    slug: id,
    projectID,
    directory: "/project",
    title,
    version: "1",
    time: { created: updated, updated },
  }) as Session.Info

const selfInfo = info(selfID, "self", now)
const activeInfo = info(activeID, "active peer", now)
const staleInfo = info(staleID, "stale peer", now - 1000 * 60 * 60 * 100)

// Mutable so each test can reconfigure the visible sibling roster.
const roster: { peers: Session.Info[] } = { peers: [selfInfo, activeInfo, staleInfo] }

const sessionLayer = Layer.mock(Session.Service, {
  get: (id: SessionID) => {
    const found = [selfInfo, activeInfo, staleInfo].find((session) => session.id === id)
    return found ? Effect.succeed(found) : Effect.fail(new NotFoundError({ message: "not found" }))
  },
  list: () => Effect.succeed([selfInfo, ...roster.peers.filter((peer) => peer.id !== selfID)]),
})

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Database.node,
      Coordination.node,
      FileAttribution.node,
      FileTouch.node,
      FSUtil.node,
      Truncate.node,
      Agent.node,
      LayerNode.make({ service: Session.Service, layer: sessionLayer, deps: [] }),
    ]),
  ),
)

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const ctx = {
  sessionID: selfID,
  messageID: MessageID.make("msg_bc"),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const execute = Effect.fn("SessionsTest.execute")(function* (params: Record<string, unknown>) {
  const toolInfo = yield* SessionsTool
  const tool = yield* toolInfo.init()
  return yield* tool.execute(params as never, ctx as never)
})

describe("tool.sessions.query", () => {
  it.instance("posts a durable request note with sender origin metadata", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const result = yield* execute({ action: "query", target: activeID, message: "what is your ETA?" })
      expect(result.title).toBe("sessions:query")
      expect(result.output).toContain("queued")
      const meta = result.metadata as { noteID?: string }
      expect(meta.noteID).toBeString()

      const row = yield* coordination.get(meta.noteID!)
      expect(row).toMatchObject({
        kind: "request",
        fromSession: selfID,
        toSession: activeID,
        body: "what is your ETA?",
      })
      expect(row?.originMessageId).toBe("msg_bc")
      expect(row?.threadId).toBe(meta.noteID)
    }),
  )
})

describe("tool.sessions.respond", () => {
  it.instance("acking a message note settles its ledger stamps and links the reply", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      // Simulate a session-init announce addressed to the roster peer (self here).
      yield* coordination.post({
        id: "ann:peer:self",
        projectID,
        kind: "message",
        fromSession: activeID,
        toSession: selfID,
        body: "a new sibling joined",
        groupId: "ann:peer",
      })
      const result = yield* execute({ action: "respond", request_id: "ann:peer:self", message: "welcome" })
      expect(result.title).toBe("sessions:respond")

      const note = yield* coordination.get("ann:peer:self")
      expect(note?.timeRead).toBeNumber()
      expect(note?.timeAck).toBeNumber()
      const replies = yield* coordination.responsesTo("ann:peer:self")
      expect(replies).toHaveLength(1)
      expect(replies[0]).toMatchObject({ kind: "response", fromSession: selfID, toSession: activeID, body: "welcome" })
      // The respond itself is traced to the answering turn.
      expect(replies[0]?.originMessageId).toBe("msg_bc")
      // A second respond is refused — one respond per note.
      const second = yield* execute({ action: "respond", request_id: "ann:peer:self", message: "again" })
      expect(second.title).toBe("sessions:error")
      expect(second.output).toContain("already responded")
    }),
  )

  it.instance("responding to a reply note is refused", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const request = yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: activeID,
        toSession: selfID,
        body: "peer question",
      })
      const reply = yield* coordination.post({
        projectID,
        kind: "response",
        fromSession: selfID,
        toSession: activeID,
        body: "my answer",
        replyTo: request.id,
      })
      const result = yield* execute({ action: "respond", request_id: reply.id, message: "thanks" })
      expect(result.title).toBe("sessions:error")
      expect(result.output).toContain("only notes addressed to you")
    }),
  )
})

describe("tool.sessions.broadcast", () => {
  it.instance("fans out one grouped request row per live peer and returns immediately", () =>
    Effect.gen(function* () {
      yield* setup
      roster.peers = [activeInfo, staleInfo]
      const coordination = yield* Coordination.Service
      const result = yield* execute({ action: "broadcast", message: "about to git stash for a clean e2e baseline" })
      expect(result.title).toBe("sessions:broadcast")
      const meta = result.metadata as { recipients?: number; groupID?: string }
      expect(meta.recipients).toBe(1)
      expect(meta.groupID).toBeString()
      expect(result.output).toContain(`${activeID}`)
      expect(result.output).toContain(`Skipped: ${staleID}`)
      expect(result.output).toContain("does not wait")

      const inbox = yield* pollWithTimeout(
        Effect.gen(function* () {
          const items = yield* coordination.inbox({ sessionID: activeID, kinds: ["request"], unreadOnly: true })
          return items.length > 0 ? items : undefined
        }),
        "broadcast request never reached the peer inbox",
      )
      expect(inbox[0].body).toContain("[broadcast]")
      expect(inbox[0].groupId).toBe(meta.groupID)
      expect(inbox[0].originMessageId).toBe("msg_bc")
      // No response rows are awaited: the tool returned without polling.
      expect(yield* coordination.responsesTo(inbox[0].id)).toHaveLength(0)
    }),
  )

  it.instance("reports zero recipients when only stale peers exist", () =>
    Effect.gen(function* () {
      yield* setup
      roster.peers = [staleInfo]
      const result = yield* execute({ action: "broadcast", message: "about to switch branches" })
      expect(result.output).toContain("No live peers to announce to")
      expect((result.metadata as { recipients?: number }).recipients).toBe(0)
    }),
  )
})

describe("tool.sessions.query paths", () => {
  it.instance("answers from the durable ledger: self, peer, and no-record paths", () =>
    Effect.gen(function* () {
      yield* setup
      const test = yield* TestInstance
      const fs = yield* FSUtil.Service
      const touches = yield* FileTouch.Service
      const mine = path.join(test.directory, "mine.txt")
      const theirs = path.join(test.directory, "theirs.txt")
      const stranger = path.join(test.directory, "stranger.txt")
      yield* fs.writeWithDirs(mine, "mine")
      yield* fs.writeWithDirs(theirs, "theirs")
      const fp = (filepath: string) =>
        Effect.gen(function* () {
          const info = yield* fs.stat(filepath)
          return {
            mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
            size: Number(info.size),
          }
        })
      yield* touches.record({ projectID, path: mine, op: "modify", sessionID: String(selfID), fingerprint: yield* fp(mine) })
      yield* touches.record({ projectID, path: theirs, op: "create", sessionID: String(activeID), fingerprint: yield* fp(theirs) })

      const result = yield* execute({ action: "query", paths: [mine, theirs, stranger] })
      expect(result.title).toBe("sessions:query")
      expect(result.output).toContain("you wrote this")
      expect(result.output).toContain(`last written by peer ${activeID}`)
      expect(result.output).toContain("active peer")
      expect(result.output).toContain("NO RECORD")
      expect(result.output).toContain("Never silently narrow a ship")
    }),
  )

  it.instance("rejects paths combined with a target (local ledger read vs peer note)", () =>
    Effect.gen(function* () {
      yield* setup
      const result = yield* execute({ action: "query", target: activeID, message: "x", paths: ["a.ts"] })
      expect(result.title).toBe("sessions:error")
      expect(result.output).toContain("local ledger query")
    }),
  )
})
