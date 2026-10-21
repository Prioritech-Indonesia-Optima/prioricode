import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@prioricode/core/database/database"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { Session } from "@prioricode/core/session"
import { Coordination } from "@/session/coordination"
import { CoordinationTable } from "@prioricode/core/session/coordination.sql"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Database.node, Coordination.node])))

const projectID = Project.ID.global
const a = Session.ID.make("ses_coord_a")
const b = Session.ID.make("ses_coord_b")

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

  it.effect("stamps and round-trips sender-origin and fan-out group metadata", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const posted = yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: a,
        toSession: b,
        body: "grouped query",
        originMessageId: "msg_sender_1",
        originCallId: "call_sender_1",
        groupId: "grp_1",
      })
      expect(posted).toMatchObject({ originMessageId: "msg_sender_1", originCallId: "call_sender_1", groupId: "grp_1" })

      const stored = yield* coordination.get(posted.id)
      expect(stored).toMatchObject({ originMessageId: "msg_sender_1", originCallId: "call_sender_1", groupId: "grp_1" })

      // Rows without origin/group metadata stay undefined — no empty-string noise.
      const bare = yield* coordination.post({ projectID, kind: "message", fromSession: a, toSession: b, body: "bare" })
      const bareRow = yield* coordination.get(bare.id)
      expect(bareRow && "originMessageId" in bareRow).toBe(false)
      expect(bareRow && "groupId" in bareRow).toBe(false)
    }),
  )

  it.effect("postOnce inserts a deterministic id exactly once across racing callers", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const input = {
        id: "ann:race",
        projectID,
        kind: "message" as const,
        fromSession: a,
        toSession: b,
        body: "announce once",
        groupId: "ann:a",
      }
      const first = yield* coordination.postOnce(input)
      expect(first.inserted).toBe(true)
      expect(first.row.id).toBe("ann:race")

      // The racing caller (second process / next sweep) must NOT crash nor duplicate.
      const second = yield* coordination.postOnce(input)
      expect(second.inserted).toBe(false)

      const { db } = yield* Database.Service
      const rows = yield* db
        .select()
        .from(CoordinationTable)
        .where(eq(CoordinationTable.id, "ann:race"))
        .all()
        .pipe(Effect.orDie)
      expect(rows).toHaveLength(1)

      // groupExists is the durable idempotency signal for fan-outs.
      expect(yield* coordination.groupExists("grp_none")).toBe(false)
      expect(yield* coordination.groupExists("ann:a")).toBe(true)
    }),
  )

  it.effect("fan-out rows of one announce share their group id", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const groupID = `ann:${a}`
      for (const peerID of [b, Session.ID.make("ses_coord_c")]) {
        const once = yield* coordination.postOnce({
          id: `ann:${a}:${peerID}`,
          projectID,
          kind: "message",
          fromSession: a,
          toSession: peerID,
          body: "joined",
          groupId: groupID,
        })
        expect(once.inserted).toBe(true)
      }
      const inbox = yield* coordination.inbox({ sessionID: b, kinds: ["message"] })
      expect(inbox[0]?.groupId).toBe(groupID)
      expect(yield* coordination.groupExists(groupID)).toBe(true)
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
      expect(
        (yield* coordination.inbox({ sessionID: b, kinds: ["message"], unreadOnly: true })).map((i) => i.body),
      ).toEqual(["for b"])
    }),
  )

  it.effect("claimUnread stamps the claim token and caps the batch oldest-first", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      for (let i = 0; i < 20; i++) {
        yield* coordination.post({ projectID, kind: "message", fromSession: a, toSession: b, body: `flood_${i}` })
      }
      const claimed = yield* coordination.claimUnread(b, undefined, { claimToken: "msg_token_1", limit: 5 })
      expect(claimed.map((item) => item.body)).toEqual(["flood_0", "flood_1", "flood_2", "flood_3", "flood_4"])
      expect(claimed.every((item) => item.claimedBy === "msg_token_1")).toBe(true)
      expect(yield* coordination.inbox({ sessionID: b, kinds: ["message"], unreadOnly: true })).toHaveLength(15)
    }),
  )

  it.effect("markAck only acks read rows, and token-scoped acks cannot settle another claim", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const unread = yield* coordination.post({
        projectID,
        kind: "message",
        fromSession: a,
        toSession: b,
        body: "not yet claimed",
      })
      // Never acks a row that has not been injected.
      yield* coordination.markAck([unread.id])
      expect((yield* coordination.get(unread.id))?.timeAck).toBeUndefined()

      const [claimed] = yield* coordination.claimUnread(b, ["message"], { claimToken: "msg_a" })
      // The wrong claimer cannot ack it: a stale acker must not settle a re-claim.
      yield* coordination.markAck([claimed.id], "msg_b")
      expect((yield* coordination.get(claimed.id))?.timeAck).toBeUndefined()
      yield* coordination.markAck([claimed.id], "msg_a")
      expect((yield* coordination.get(claimed.id))?.timeAck).toBeNumber()
      // Tokenless ack (tool consumption paths) also works on claimed rows.
      const second = yield* coordination.post({
        projectID,
        kind: "message",
        fromSession: a,
        toSession: b,
        body: "tool consumed",
      })
      yield* coordination.markRead([second.id])
      yield* coordination.markAck([second.id])
      expect((yield* coordination.get(second.id))?.timeAck).toBeNumber()
    }),
  )

  it.effect("unclaimStaleUnacked re-queues injected-but-never-consumed rows only", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const crash = yield* coordination.post({
        projectID,
        kind: "message",
        fromSession: a,
        toSession: b,
        body: "claim then crash",
      })
      const healed = yield* coordination.post({
        projectID,
        kind: "message",
        fromSession: a,
        toSession: b,
        body: "consumed fine",
      })
      yield* coordination.claimUnread(b, ["message"], { claimToken: "msg_x" })
      yield* coordination.markAck([healed.id], "msg_x")
      // Posted after the claim: never injected, so recovery must leave it alone.
      const fresh = yield* coordination.post({
        projectID,
        kind: "message",
        fromSession: a,
        toSession: b,
        body: "still unread",
      })

      // A cutoff in the future ages every row; only read+unacked qualify.
      const unclaimed = yield* coordination.unclaimStaleUnacked({ sessionIDs: [b], cutoffMs: Date.now() + 1_000 })
      expect(unclaimed).toBe(1)
      expect((yield* coordination.get(crash.id))?.timeRead).toBeUndefined()
      expect((yield* coordination.get(crash.id))?.claimedBy).toBeUndefined()
      expect((yield* coordination.get(healed.id))?.timeRead).toBeNumber()
      expect((yield* coordination.get(healed.id))?.timeAck).toBeNumber()
      expect((yield* coordination.get(fresh.id))?.timeRead).toBeUndefined()
      // The re-queued row is deliverable again — exactly once — oldest first,
      // alongside the fresh row that was never claimed.
      const redelivered = yield* coordination.claimUnread(b, ["message"], { claimToken: "msg_y" })
      expect(redelivered.map((item) => item.body)).toEqual(["claim then crash", "still unread"])
      expect(redelivered.every((item) => item.claimedBy === "msg_y")).toBe(true)
    }),
  )

  it.effect("requestState derives the ledger state, first match wins", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const base = {
        id: "coo_x",
        projectID,
        kind: "request" as const,
        fromSession: a,
        toSession: b,
        body: "q",
        timeCreated: 1,
      }
      expect(Coordination.requestState({ ...base }, false)).toBe("pending")
      expect(Coordination.requestState({ ...base, timeRead: 2 }, false)).toBe("injected")
      expect(Coordination.requestState({ ...base, timeRead: 2, timeAck: 3 }, false)).toBe("acked")
      expect(Coordination.requestState({ ...base, timeRead: 2, timeAck: 3, timeEscalated: 5 }, false)).toBe("escalated")
      expect(Coordination.requestState({ ...base, timeExpired: 4 }, false)).toBe("expired")
      // answered wins over everything else
      expect(
        Coordination.requestState({ ...base, timeRead: 2, timeAck: 3, timeEscalated: 5, timeExpired: 4 }, true),
      ).toBe("answered")
    }),
  )

  it.effect("the unique partial index rejects a second response for one request", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const coordination = yield* Coordination.Service
      const request = yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: a,
        toSession: b,
        body: "one response only",
      })
      yield* coordination.post({
        projectID,
        kind: "response",
        fromSession: b,
        toSession: a,
        body: "first answer",
        replyTo: request.id,
      })
      // A second response for the same request must fail at the DB level.
      const second = yield* db
        .insert(CoordinationTable)
        .values({
          id: "coo_second_response",
          project_id: projectID,
          kind: "response",
          from_session: b,
          to_session: a,
          body: "duplicate answer",
          reply_to: request.id,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
        .pipe(Effect.exit)
      expect(second._tag).toBe("Failure")
      // Distinct requests may each have their own response.
      const other = yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: a,
        toSession: b,
        body: "another question",
      })
      yield* coordination.post({
        projectID,
        kind: "response",
        fromSession: b,
        toSession: a,
        body: "other answer",
        replyTo: other.id,
      })
      expect(yield* coordination.responsesTo(other.id)).toHaveLength(1)
    }),
  )

  it.effect("sentBy and responsesFor expose the sender-side receipt ledger", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const note = yield* coordination.post({ projectID, kind: "message", fromSession: a, toSession: b, body: "fyi" })
      const request = yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: a,
        toSession: b,
        body: "status?",
      })
      // Claim-side rows addressed to b are not part of a's sent ledger, and vice versa.
      expect((yield* coordination.sentBy({ sessionID: a, withinMs: 60_000 })).map((item) => item.id).sort()).toEqual(
        [note.id, request.id].sort(),
      )
      expect(yield* coordination.sentBy({ sessionID: b, withinMs: 60_000 })).toHaveLength(0)
      expect(yield* coordination.responsesFor([request.id])).toHaveLength(0)
      yield* coordination.post({
        projectID,
        kind: "response",
        fromSession: b,
        toSession: a,
        body: "still working",
        replyTo: request.id,
      })
      const responses = yield* coordination.responsesFor([note.id, request.id])
      expect(responses).toHaveLength(1)
      expect(responses[0]).toMatchObject({ body: "still working", replyTo: request.id })
    }),
  )

  it.effect("claimUnread delivers response and record rows (late replies are not orphaned)", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const request = yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: a,
        toSession: b,
        body: "status?",
      })
      yield* coordination.claimUnread(b, undefined, { claimToken: "msg_1" })
      yield* coordination.markAck([request.id], "msg_1")
      yield* coordination.post({
        projectID,
        kind: "response",
        fromSession: b,
        toSession: a,
        body: "late answer",
        replyTo: request.id,
      })
      yield* coordination.post({
        projectID,
        kind: "record",
        fromSession: b,
        toSession: b,
        body: "answered on your behalf",
      })
      const delivered = yield* coordination.claimUnread(a, undefined, { claimToken: "msg_2" })
      expect(delivered.map((item) => item.kind)).toEqual(["response"])
      const records = yield* coordination.claimUnread(b, undefined, { claimToken: "msg_3" })
      expect(records.map((item) => item.body)).toEqual(["answered on your behalf"])
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
    expect(text).toContain("owes exactly one respond")
    expect(text).toContain("I am on src/foo.ts")
    expect(text).toContain("[announce from your session")
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

  it.effect("formatNotes renders replies and records without laundering them as messages", () => {
    const response = {
      id: "coo_resp",
      projectID,
      kind: "response" as const,
      fromSession: a,
      toSession: b,
      body: "still working, ETA 10m",
      replyTo: "coo_req",
      timeCreated: 0,
    }
    const record = {
      id: "coo_rec",
      projectID,
      kind: "record" as const,
      fromSession: b,
      toSession: b,
      body: "Your session answered a request from ses_x: ...",
      timeCreated: 0,
    }
    const text = Coordination.formatNotes([response, record])
    expect(text).toContain("to your earlier note coo_req")
    expect(text).toContain("still working, ETA 10m")
    expect(text).toContain("NEVER respond to this reply")
    // A reply must never look like it needs a respond call.
    expect(text).not.toContain('respond", request_id "coo_resp')
    expect(text).toContain("[ledger from your session")
    expect(text).toContain("Your session answered a request from ses_x")
    // Ack discipline: every note owes one respond, replies/ledger never do.
    expect(text).toContain("Ack discipline")
    expect(text).toContain("Never respond to a [reply]")
    return Effect.sync(() => {})
  })

  it.effect("formatNotes flags a follow-up request as part of an existing thread", () => {
    const followUp = {
      id: "coo_follow",
      projectID,
      kind: "request" as const,
      fromSession: a,
      toSession: b,
      body: "can I add a field?",
      timeCreated: 3,
      threadId: "coo_root",
    }
    const text = Coordination.formatNotes([followUp])
    expect(text).toContain("follow-up in thread coo_root")
    const root = { ...followUp, threadId: "coo_follow" }
    expect(Coordination.formatNotes([root])).not.toContain("follow-up in thread")
    return Effect.sync(() => {})
  })

  it.effect("formatPresence is a read-only ambient roster and empty for solo sessions", () =>
    Effect.sync(() => {
      const solo = Coordination.formatPresence([])
      expect(solo).toBeUndefined()
      const text = Coordination.formatPresence([
        { id: b, title: "Fix release pipeline", agent: "build", busy: true, lastActiveMs: 1_000 },
        { id: a, title: "Upgrade failure", busy: false, lastActiveMs: 5 * 60_000 },
      ])
      expect(text).toContain("cross-session-presence")
      expect(text).toContain("ambient awareness")
      expect(text).toContain("working now")
      expect(text).toContain(b)
      expect(text).toContain(a)
      expect(text).toContain("do NOT message or wake a peer just to say hello")
      const withOutstanding = Coordination.formatPresence(
        [{ id: b, title: "Fix release pipeline", busy: true, lastActiveMs: 1_000 }],
        { count: 3, oldestAgeMs: 5 * 60_000 },
      )
      expect(withOutstanding).toContain("Your outstanding notes: 3 awaiting a peer respond")
      expect(withOutstanding).toContain("oldest sent 5m ago")
      expect(
        Coordination.formatPresence([{ id: b, title: "x", busy: false, lastActiveMs: 1_000 }], { count: 0 }),
      ).not.toContain("outstanding")
    }),
  )

  it.effect("query rows are wake-kind but message/record rows never wake", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: a,
        toSession: b,
        body: "are you done?",
      })
      const wakeInbox = yield* coordination.inbox({
        sessionID: b,
        kinds: Coordination.WAKE_KINDS,
        unreadOnly: true,
      })
      expect(wakeInbox.map((item) => item.kind)).toEqual(["request"])
      // message (announce) and record rows are delivered but never wake-worthy.
      yield* coordination.post({ projectID, kind: "message", fromSession: a, toSession: b, body: "ambient announce" })
      yield* coordination.post({ projectID, kind: "record", fromSession: b, toSession: b, body: "audit" })
      const wakeKinds = yield* coordination.inbox({
        sessionID: b,
        kinds: Coordination.WAKE_KINDS,
        unreadOnly: true,
      })
      expect(wakeKinds.every((item) => item.kind === "request")).toBe(true)
      expect(Coordination.WAKE_KINDS).toEqual(["request", "response"])
    }),
  )

  it.effect("guardNote rate-limits a chatty sender past the per-minute cap", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      // Fill the rolling window to the default cap (10) with distinct bodies.
      for (let i = 0; i < 10; i++)
        yield* coordination.post({
          projectID,
          kind: "message",
          fromSession: a,
          toSession: b,
          body: `note ${i}`,
        })
      const guard = yield* coordination.guardNote({
        fromSession: a,
        toSession: b,
        kind: "message",
        body: "one more",
      })
      expect(guard.blocked).toContain("Rate limited")
      // A different recipient is unaffected.
      const other = yield* coordination.guardNote({
        fromSession: a,
        toSession: Session.ID.make("ses_coord_c"),
        kind: "message",
        body: "one more",
      })
      expect(other.blocked).toBeUndefined()
    }),
  )

  it.effect("guardNote dedupes an identical still-unprocessed note to the same target", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      yield* coordination.post({ projectID, kind: "message", fromSession: a, toSession: b, body: "are you done?" })
      const dup = yield* coordination.guardNote({
        fromSession: a,
        toSession: b,
        kind: "message",
        body: "are you done?",
      })
      expect(dup.blocked).toContain("Already sent")
      // A different body is allowed.
      const fresh = yield* coordination.guardNote({
        fromSession: a,
        toSession: b,
        kind: "message",
        body: "different question?",
      })
      expect(fresh.blocked).toBeUndefined()
    }),
  )

  it.effect("escalateDue then expireDue each fire once for an unanswered request", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const coordination = yield* Coordination.Service
      const request = yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: a,
        toSession: b,
        body: "will this ever be answered?",
      })
      const backdate = (ms: number) =>
        db
          .update(CoordinationTable)
          .set({ time_created: Date.now() - ms, time_updated: Date.now() - ms })
          .where(eq(CoordinationTable.id, request.id))
          .run()
          .pipe(Effect.orDie)

      // Not due yet.
      expect(yield* coordination.escalateDue()).toHaveLength(0)
      // Past the 15-min escalation grace → escalated exactly once.
      yield* backdate(16 * 60_000)
      const escalated = yield* coordination.escalateDue()
      expect(escalated.map((item) => item.id)).toEqual([request.id])
      expect(yield* coordination.escalateDue()).toHaveLength(0)
      // Still not expired (needs escalation + a further grace).
      expect(yield* coordination.expireDue()).toHaveLength(0)
      // Past escalation + expiry grace → expired exactly once, and terminal.
      yield* backdate(31 * 60_000)
      const expired = yield* coordination.expireDue()
      expect(expired.map((item) => item.id)).toEqual([request.id])
      expect(yield* coordination.expireDue()).toHaveLength(0)
    }),
  )

  it.effect("requests root a thread; replies and follow-ups join it in order", () =>
    Effect.gen(function* () {
      yield* setup
      const coordination = yield* Coordination.Service
      const root = yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: a,
        toSession: b,
        body: "round 1",
      })
      // A root request is its own thread.
      expect(root.threadId).toBe(root.id)
      const reply = yield* coordination.post({
        projectID,
        kind: "response",
        fromSession: b,
        toSession: a,
        body: "answer 1",
        replyTo: root.id,
        threadId: root.threadId,
      })
      const followUp = yield* coordination.post({
        projectID,
        kind: "request",
        fromSession: a,
        toSession: b,
        body: "round 2",
        threadId: root.threadId,
      })
      expect(followUp.threadId).toBe(root.id)
      const rows = yield* coordination.thread(root.id)
      expect(rows.map((row) => row.id)).toEqual([root.id, reply.id, followUp.id])
      // A message not tied to a thread has no thread_id.
      const note = yield* coordination.post({
        projectID,
        kind: "message",
        fromSession: a,
        toSession: b,
        body: "loose note",
      })
      expect(note.threadId).toBeUndefined()
    }),
  )
})
