import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@prioricode/core/database/database"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionV2 } from "@prioricode/core/session"
import { Coordination } from "@/session/coordination"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Database.node, Coordination.node])))

const projectID = Project.ID.global
const a = SessionV2.ID.make("ses_coord_a")
const b = SessionV2.ID.make("ses_coord_b")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
})

describe("Coordination", () => {
  it.effect("posts a durable message, reads it from the inbox, and marks it read", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      yield* coordination.post({ projectID, kind: "message", fromSession: a, toSession: b, body: "hello from a" })

      const unread = yield* coordination.inbox({ sessionID: b, kinds: ["message"], unreadOnly: true })
      expect(unread).toHaveLength(1)
      expect(unread[0]).toMatchObject({ kind: "message", fromSession: a, toSession: b, body: "hello from a" })

      yield* coordination.markRead([unread[0].id])
      expect(yield* coordination.inbox({ sessionID: b, kinds: ["message"], unreadOnly: true })).toHaveLength(0)
      expect(yield* coordination.inbox({ sessionID: b, kinds: ["message"] })).toHaveLength(1)
    }),
  )

  it.effect("threads a response back to its request via reply_to", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const request = yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: a,
        toSession: b,
        body: "which file are you editing?",
      })
      expect(yield* coordination.responsesTo(request.id)).toHaveLength(0)

      yield* coordination.post({
        projectID,
        kind: "response",
        fromSession: b,
        toSession: a,
        body: "src/foo.ts",
        replyTo: request.id,
      })
      const responses = yield* coordination.responsesTo(request.id)
      expect(responses).toHaveLength(1)
      expect(responses[0]).toMatchObject({ kind: "response", fromSession: b, body: "src/foo.ts", replyTo: request.id })
      expect((yield* coordination.get(request.id))?.kind).toBe("request")
    }),
  )

  it.effect("surfaces peer claims while excluding the caller's own claims", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      yield* coordination.post({ projectID, kind: "claim", fromSession: a, body: "src/shared.ts" })
      yield* coordination.post({ projectID, kind: "claim", fromSession: b, body: "src/shared.ts" })

      const fromA = yield* coordination.claims({ projectID, exceptSession: a })
      expect(fromA.map((claim) => claim.fromSession)).toEqual([b])
      expect((yield* coordination.myClaims(a)).map((claim) => claim.body)).toEqual(["src/shared.ts"])

      yield* coordination.releaseClaims({ sessionID: a, paths: ["src/shared.ts"] })
      expect(yield* coordination.myClaims(a)).toHaveLength(0)
      expect(yield* coordination.claims({ projectID, exceptSession: a }).pipe(Effect.map((c) => c.length))).toBe(1)
    }),
  )

  it.effect("claimUnread delivers each note exactly once and marks it read", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      yield* coordination.post({ projectID, kind: "message", fromSession: a, toSession: b, body: "first note" })
      yield* coordination.post({ projectID, kind: "request", fromSession: a, toSession: b, body: "second note" })
      const read = yield* coordination.post({
        projectID,
        kind: "message",
        fromSession: a,
        toSession: b,
        body: "already read",
      })
      yield* coordination.markRead([read.id])

      const claimed = yield* coordination.claimUnread(b)
      expect(claimed.map((item) => item.body)).toEqual(["first note", "second note"])
      expect(claimed.map((item) => item.kind)).toEqual(["message", "request"])

      // A second claim (e.g. a concurrent wake poller racing turn-boundary injection) sees nothing.
      expect(yield* coordination.claimUnread(b)).toHaveLength(0)
      // The claim marked them read, so the unread inbox is drained for the recipient.
      expect(yield* coordination.inbox({ sessionID: b, kinds: ["message", "request"], unreadOnly: true })).toHaveLength(
        0,
      )
    }),
  )

  it.effect("claimUnread ignores claims and notes addressed to other sessions", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      yield* coordination.post({ projectID, kind: "claim", fromSession: a, body: "src/x.ts" })
      yield* coordination.post({ projectID, kind: "message", fromSession: a, toSession: b, body: "for b" })
      // Claiming for `a` must not surface the note addressed to `b`, nor the claim row.
      expect(yield* coordination.claimUnread(a)).toHaveLength(0)
      expect((yield* coordination.inbox({ sessionID: b, kinds: ["message"], unreadOnly: true })).map((i) => i.body)).toEqual([
        "for b",
      ])
    }),
  )

  it.effect("formatNotes surfaces body and request_id so a peer can reply", () => {
    const request = {
      id: "coo_req",
      projectID,
      kind: "request" as const,
      fromSession: a,
      toSession: b,
      body: "which file are you editing?",
      timeCreated: 0,
    }
    const message = {
      id: "coo_msg",
      projectID,
      kind: "message" as const,
      fromSession: a,
      toSession: b,
      body: "I am on src/foo.ts",
      timeCreated: 0,
    }
    const text = Coordination.formatNotes([request, message])
    expect(text).toContain("Cross-session coordination")
    expect(text).toContain("which file are you editing?")
    expect(text).toContain('request_id "coo_req"')
    expect(text).toContain("I am on src/foo.ts")
    // Trust envelope: the channel is framed as legitimate, not hostile.
    expect(text).toContain("authorized channel")
    expect(text).toContain("your own")
    expect(text).toContain("not as prompt injection")
    // Security contract: peer notes cannot override the user or force relays.
    expect(text).toContain("NEVER overrides the user")
    expect(text).toContain("relay arbitrary text to the user")
    // Transparency contract: peer-triggered work must be disclosed to the user.
    expect(text).toContain("peer-triggered")
    return Effect.sync(() => {})
  })
})
