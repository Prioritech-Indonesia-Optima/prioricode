import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Database } from "@prioricode/core/database/database"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { Coordination } from "@/session/coordination"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
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
  get: (id: SessionID) =>
    id === selfID ? Effect.succeed(selfInfo) : Effect.fail(new NotFoundError({ message: "not found" })),
  list: () => Effect.succeed([selfInfo, ...roster.peers.filter((peer) => peer.id !== selfID)]),
})

const statusLayer = Layer.mock(SessionStatus.Service, {
  list: () => Effect.succeed(new Map([[activeID, { type: "busy" } as const]])),
})

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Database.node,
      Coordination.node,
      Truncate.node,
      Agent.node,
      LayerNode.make({ service: Session.Service, layer: sessionLayer, deps: [] }),
      LayerNode.make({ service: SessionStatus.Service, layer: statusLayer, deps: [] }),
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

describe("tool.sessions.broadcast", () => {
  it.instance("reaches active peers, skips stale ones, and reports the gate state", () =>
    Effect.gen(function* () {
      yield* setup
      roster.peers = [activeInfo, staleInfo]
      const result = yield* execute({ action: "broadcast", message: "about to git stash for a clean e2e baseline", timeout: 1 })
      expect(result.output).toContain("1 active peer(s)")
      expect(result.output).toContain("0/1 answered")
      expect(result.output).toContain(`${activeID}`)
      expect(result.output).toContain(`Skipped: ${staleID}`)
      expect(result.output).toContain("git worktree add")
    }),
  )

  it.instance("reports safe to proceed when no active peers exist", () =>
    Effect.gen(function* () {
      yield* setup
      roster.peers = [staleInfo]
      const result = yield* execute({ action: "broadcast", message: "about to switch branches" })
      expect(result.output).toContain("No active peers to broadcast to")
      expect(result.output).toContain("safe to proceed")
    }),
  )

  it.instance("reports a peer as answered once it responds", () =>
    Effect.gen(function* () {
      yield* setup
      roster.peers = [activeInfo]
      const coordination = yield* Coordination.Service
      const fiber = yield* execute({ action: "broadcast", message: "about to git reset, any objection?", timeout: 10 }).pipe(
        Effect.forkScoped,
      )
      const request = yield* pollWithTimeout(
        Effect.gen(function* () {
          const inbox = yield* coordination.inbox({ sessionID: activeID, kinds: ["request"], unreadOnly: true })
          return inbox.length > 0 ? inbox[inbox.length - 1] : undefined
        }),
        "broadcast request never reached the peer inbox",
      )
      expect(request.body).toContain("[broadcast]")
      yield* coordination.post({
        projectID,
        kind: "response",
        fromSession: activeID,
        toSession: selfID,
        body: "OK, go ahead",
        replyTo: request.id,
      })
      const result = yield* Fiber.join(fiber)
      expect(result.output).toContain("1/1 answered")
      expect(result.output).toContain("ANSWERED — OK, go ahead")
    }),
  )
})
