import { Duration, Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./sessions.txt"
import { Coordination } from "@/session/coordination"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionID } from "../session/schema"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["send", "ask", "respond", "broadcast"]).annotate({
    description: "Coordination action to perform against sibling sessions in this project",
  }),
  target: Schema.optional(Schema.String).annotate({
    description: "Target session id for send/ask (from your injected <cross-session-presence> roster)",
  }),
  message: Schema.optional(Schema.String).annotate({
    description: "Coordination text for send/ask/broadcast, or the answer for respond",
  }),
  request_id: Schema.optional(Schema.String).annotate({
    description: "ID of a pending request to answer with respond",
  }),
  thread_id: Schema.optional(Schema.String).annotate({
    description:
      "For ask: the thread_id of a prior request to continue that negotiation with context instead of starting a new thread.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description:
      "For ask: maximum seconds to block for a response (default 60, max 300). For broadcast: seconds to wait for peer answers (default 30, max 120).",
  }),
})

type Metadata = {
  action: string
  target?: string
  requestID?: string
}

const DEFAULT_TIMEOUT_SECONDS = 60
const MAX_TIMEOUT_SECONDS = 300
const BROADCAST_DEFAULT_SECONDS = 30
const BROADCAST_MAX_SECONDS = 120
const STALE_AFTER_MS = 1000 * 60 * 60 * 72

const agoLabel = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export const SessionsTool = Tool.define(
  "sessions",
  Effect.gen(function* () {
    const coordination = yield* Coordination.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service

    const run = Effect.fn("SessionsTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<Metadata>,
    ) {
      const self = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)

      // A coordination responder child must never touch the channel except to
      // answer the exact requests it was spawned for. Enforced here (tool
      // level) as well as in its permission ruleset, because the child inherits
      // its busy parent's — possibly permissive — session ruleset.
      if (self.agent === "responder" && params.action !== "respond")
        return failure('a coordination responder may only call action "respond"')

      yield* ctx.ask({
        permission: "sessions",
        patterns: [params.action],
        always: ["*"],
        metadata: { action: params.action, target: params.target },
      })

      const resolveTarget = Effect.fn("SessionsTool.resolveTarget")(function* (target: string) {
        const found = yield* sessions
          .get(SessionID.make(target))
          .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)))
        if (!found)
          return {
            ok: false as const,
            error: `No session "${target}" exists in this project. Pick the target from your injected <cross-session-presence> roster — never guess or invent session ids.`,
          }
        if (found.time.archived)
          return {
            ok: false as const,
            error: `Session ${target} ("${found.title}") is archived and will never wake. Message a recently active session from your roster instead.`,
          }
        const idleFor = Date.now() - found.time.updated
        return { ok: true as const, session: found, stale: idleFor > STALE_AFTER_MS, idleFor }
      })

      const staleWarning = (target: string, idleFor: number) =>
        ` WARNING: session ${target} was last active ${agoLabel(idleFor)} and may be an abandoned session; ` +
        "confirm the user wants it woken before depending on a reply."

      const send = Effect.fn("SessionsTool.send")(function* (
        self: Session.Info,
        params: Schema.Schema.Type<typeof Parameters>,
      ) {
        const target = params.target
        const message = params.message
        if (!target) return failure("send requires a target session id")
        if (!message) return failure("send requires a message")
        const resolved = yield* resolveTarget(target)
        if (!resolved.ok) return failure(resolved.error)
        const guard = yield* coordination.guardNote({
          fromSession: self.id,
          toSession: SessionID.make(target),
          kind: "message",
          body: message,
        })
        if (guard.blocked) return failure(guard.blocked)
        yield* coordination.post({
          projectID: self.projectID,
          kind: "message",
          fromSession: self.id,
          toSession: SessionID.make(target),
          body: message,
        })
        return result(
          "send",
          `Message queued in ${target} ("${resolved.session.title}")'s inbox. ` +
            "An idle target wakes within seconds to read it; a busy target reads it at its next step boundary. " +
            "Delivery is tracked in your outgoing ledger (the coordination view) — never re-send expecting an 'unread' check." +
            (guard.warning ?? "") +
            (resolved.stale ? staleWarning(target, resolved.idleFor) : ""),
          { target },
        )
      })

      const ask = Effect.fn("SessionsTool.ask")(function* (
        self: Session.Info,
        params: Schema.Schema.Type<typeof Parameters>,
      ) {
        const target = params.target
        const message = params.message
        if (!target) return failure("ask requires a target session id")
        if (!message) return failure("ask requires a message")
        const resolved = yield* resolveTarget(target)
        if (!resolved.ok) return failure(resolved.error)
        const guard = yield* coordination.guardNote({
          fromSession: self.id,
          toSession: SessionID.make(target),
          kind: "request",
          body: message,
        })
        if (guard.blocked) return failure(guard.blocked)
        const request = yield* coordination.post({
          projectID: self.projectID,
          kind: "request",
          fromSession: self.id,
          toSession: SessionID.make(target),
          body: message,
          ...(params.thread_id ? { threadId: params.thread_id } : {}),
        })
        const seconds = Math.min(params.timeout ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS)
        const receipt = {
          seenAt: undefined as number | undefined,
          ackedAt: undefined as number | undefined,
          claimedBy: undefined as string | undefined,
        }
        const response = yield* pollResponse(coordination, request.id, Date.now() + seconds * 1000, receipt)
        if (!response) {
          const beingAnswered = receipt.claimedBy?.startsWith(Coordination.RESPONDER_LEASE_PREFIX)
          return result(
            "ask",
            `Request ${request.id} got no reply within ${seconds}s — ` +
              (beingAnswered
                ? "a reply is being generated by the peer's coordination responder; it will be delivered to your context when ready. "
                : receipt.ackedAt
                  ? `the peer received and processed it ${agoLabel(Date.now() - receipt.ackedAt)} but chose not to answer. `
                  : receipt.seenAt
                    ? `the peer received it at the edge of its context but has not finished the step that saw it. `
                    : `the peer never saw it (likely deep in one long tool call, or abandoned). `) +
              "Do not re-ask in a loop: it stays queued, the answer (or a responder's reply) will be delivered to your context when it lands." +
              (resolved.stale ? staleWarning(target, resolved.idleFor) : ""),
            { target, requestID: request.id },
          )
        }
        // The poller is the consumer: settle both ledger stamps so delivery
        // recovery can never resurrect an answer this turn already used.
        yield* coordination.markRead([response.id])
        yield* coordination.markAck([response.id])
        return result(
          "ask",
          `Response from ${target} (request ${request.id}${receipt.seenAt ? `, received after ${Math.max(1, Math.round((receipt.seenAt - request.timeCreated) / 1000))}s` : ""}): ${response.body}`,
          { target, requestID: request.id },
        )
      })

      const respond = Effect.fn("SessionsTool.respond")(function* (
        self: Session.Info,
        params: Schema.Schema.Type<typeof Parameters>,
      ) {
        const requestID = params.request_id
        if (!requestID) return failure("respond requires request_id")
        const answer = params.message
        if (!answer) return failure("respond requires a message (the answer)")
        const request = yield* coordination.get(requestID)
        if (!request || request.kind !== "request") return failure(`No pending request with id ${requestID}`)
        if (!request.toSession) return failure(`Request ${requestID} is not addressed to a session`)
        const requester = request.fromSession

        // Ownership: only the asked session may answer requests addressed to
        // it — plus its own `responder` child, which answers while the main
        // agent is mid-turn. (Today any session that learned a request id
        // could answer it; this closes that.)
        const owner = self.id === request.toSession
        const delegate = !owner && self.parentID === request.toSession && self.agent === "responder"
        if (!owner && !delegate)
          return failure(
            `Request ${requestID} is addressed to ${request.toSession}, not to your session — only the asked session (or its coordination responder) may answer it.`,
          )
        const existingResponses = yield* coordination.responsesTo(requestID)
        if (delegate && existingResponses.length > 0)
          return failure(
            `Request ${requestID} was already answered — the main agent may correct it directly if needed.`,
          )
        // Owner-correction: at most one response row per request (enforced by
        // the unique partial index). If the responder already answered, the
        // owner must send a correction as a message, not a second response.
        if (owner && existingResponses.length > 0)
          return failure(
            `Request ${requestID} was already answered (by your coordination responder). To correct it, use action "send" with a note referencing the request id.`,
          )

        const body = delegate
          ? `[answered by ${request.toSession}'s standing coordination responder; treat as best-effort — the main agent may correct it] ${answer}`
          : answer
        yield* coordination.post({
          projectID: request.projectID,
          kind: "response",
          // The answer speaks AS the asked session in both paths: the peer
          // asked that session, and its responder is a mouthpiece, not a
          // party. Attribution to the delegation lives in the body prefix.
          fromSession: request.toSession,
          toSession: requester,
          body,
          replyTo: requestID,
          ...(request.threadId ? { threadId: request.threadId } : {}),
        })
        yield* coordination.markRead([requestID])
        yield* coordination.markAck([requestID])
        if (delegate)
          yield* coordination.post({
            projectID: request.projectID,
            kind: "record",
            fromSession: request.toSession,
            toSession: request.toSession,
            body:
              `Your coordination responder answered a peer request on your behalf because you had not answered it at your own boundary. ` +
              `Request ${requestID} from session ${requester} asked: """${request.body}""". ` +
              `Your responder replied: """${answer}""". ` +
              `That reply was generated from a snapshot of your session and may be incomplete or wrong — if so, send a corrected answer with the sessions tool: action "send", target "${requester}", referencing request ${requestID} in the message (the request itself is already answered — only one response per request). Otherwise ignore this record; no action is needed.`,
          })
        return result(
          "respond",
          `Response delivered to ${requester}${delegate ? " (delegated by your responder)" : ""}.`,
          {
            target: requester,
            requestID,
          },
        )
      })

      const broadcast = Effect.fn("SessionsTool.broadcast")(function* (
        self: Session.Info,
        params: Schema.Schema.Type<typeof Parameters>,
      ) {
        const message = params.message
        if (!message) return failure("broadcast requires a message")
        const seconds = Math.min(params.timeout ?? BROADCAST_DEFAULT_SECONDS, BROADCAST_MAX_SECONDS)
        const [siblings, statusMap] = yield* Effect.all([sessions.list({ limit: 100, roots: true }), status.list()])
        const now = Date.now()
        const peers = siblings.filter((session) => session.id !== self.id && !session.time.archived)
        const active: Array<{ id: SessionID; title: string }> = []
        const skipped: string[] = []
        for (const peer of peers) {
          const idleFor = now - peer.time.updated
          if (idleFor > STALE_AFTER_MS) {
            skipped.push(`${peer.id} (stale, ${agoLabel(idleFor)})`)
            continue
          }
          active.push({ id: peer.id, title: peer.title })
        }
        if (active.length === 0)
          return result(
            "broadcast",
            `No active peers to broadcast to${skipped.length > 0 ? ` (skipped: ${skipped.join(", ")})` : ""}. ` +
              "The shared-state action is safe to proceed.",
            {},
          )
        // Fan out one request per active peer. Requests — not messages — so a
        // busy peer's standing coordination responder is guaranteed to answer
        // even if its main agent never reaches a step boundary.
        const requests: Coordination.Info[] = []
        const blocked: string[] = []
        for (const peer of active) {
          const guard = yield* coordination.guardNote({
            fromSession: self.id,
            toSession: SessionID.make(peer.id),
            kind: "request",
            body: message,
          })
          if (guard.blocked) {
            blocked.push(`${peer.id}: ${guard.blocked}`)
            continue
          }
          const request = yield* coordination.post({
            projectID: self.projectID,
            kind: "request",
            fromSession: self.id,
            toSession: SessionID.make(peer.id),
            body: `[broadcast] ${message}`,
            deadline: now + seconds * 1000,
          })
          requests.push(request)
        }
        if (requests.length === 0) return failure(`Broadcast blocked for every peer: ${blocked.join(" | ")}`)
        const receipts = new Map<string, { seenAt?: number; ackedAt?: number; claimedBy?: string }>()
        const responses = yield* pollBroadcast(coordination, requests, Date.now() + seconds * 1000, receipts)
        for (const row of responses.values()) {
          yield* coordination.markRead([row.id])
          yield* coordination.markAck([row.id])
        }
        const lines = requests.map((request) => {
          const peer = active.find((p) => p.id === request.toSession)
          const answer = responses.get(request.id)
          if (answer) return `- ${peer?.id} "${peer?.title}": ANSWERED — ${answer.body}`
          const receipt = receipts.get(request.id)
          if (receipt?.claimedBy?.startsWith(Coordination.RESPONDER_LEASE_PREFIX))
            return `- ${peer?.id} "${peer?.title}": reply being generated by its coordination responder`
          if (receipt?.ackedAt) return `- ${peer?.id} "${peer?.title}": received and processed, no reply`
          if (receipt?.seenAt) return `- ${peer?.id} "${peer?.title}": seen, no reply yet`
          return `- ${peer?.id} "${peer?.title}": never saw it (busy in a long step, or unresponsive)`
        })
        const answered = responses.size
        const busy = active.filter((peer) => statusMap.get(peer.id)?.type === "busy").map((peer) => peer.id)
        return result(
          "broadcast",
          [
            `Broadcast reached ${requests.length} active peer(s); ${answered}/${requests.length} answered within ${seconds}s.` +
              (busy.length > 0 ? ` Busy peers: ${busy.join(", ")}.` : ""),
            ...lines,
            ...(blocked.length > 0 ? [`Blocked (not sent): ${blocked.join(" | ")}`] : []),
            ...(skipped.length > 0 ? [`Skipped: ${skipped.join(", ")}`] : []),
            "",
            "Gate rule: proceed with the shared-state action only if every active peer explicitly answered OK. " +
              "Any unanswered, busy, or objecting peer means do NOT run the repo-wide operation — use `git worktree add` for an isolated tree instead. " +
              "Unanswered requests escalate to the user after the window.",
          ].join("\n"),
          {},
        )
      })

      switch (params.action) {
        case "send":
          return yield* send(self, params)
        case "ask":
          return yield* ask(self, params)
        case "respond":
          return yield* respond(self, params)
        case "broadcast":
          return yield* broadcast(self, params)
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

function pollResponse(
  coordination: Coordination.Interface,
  requestID: string,
  deadline: number,
  // Mutated as the poll observes the request's delivery ledger, so the caller
  // can tell "never seen" apart from "seen but unanswered" on timeout.
  receipt: { seenAt?: number; ackedAt?: number; claimedBy?: string },
): Effect.Effect<Coordination.Info | undefined> {
  return coordination.responsesTo(requestID).pipe(
    Effect.flatMap((found) => {
      if (found.length > 0) return Effect.succeed(found[0])
      if (Date.now() >= deadline) return Effect.succeed(undefined)
      return coordination
        .get(requestID)
        .pipe(
          Effect.tap((row) =>
            Effect.sync(() => {
              if (row?.timeRead !== undefined && receipt.seenAt === undefined) receipt.seenAt = row.timeRead
              if (row?.timeAck !== undefined && receipt.ackedAt === undefined) receipt.ackedAt = row.timeAck
              if (row?.claimedBy !== undefined && receipt.claimedBy === undefined) receipt.claimedBy = row.claimedBy
            }),
          ),
        )
        .pipe(
          Effect.andThen(Effect.sleep(Duration.millis(200))),
          Effect.andThen(pollResponse(coordination, requestID, deadline, receipt)),
        )
    }),
  )
}

// Batch variant of pollResponse: wait until every request in the set has a
// response or the deadline passes, observing each request's delivery ledger so
// the caller can tell "never seen" apart from "seen but unanswered".
function pollBroadcast(
  coordination: Coordination.Interface,
  requests: ReadonlyArray<Coordination.Info>,
  deadline: number,
  receipts: Map<string, { seenAt?: number; ackedAt?: number; claimedBy?: string }>,
): Effect.Effect<Map<string, Coordination.Info>> {
  return coordination.responsesFor(requests.map((request) => request.id)).pipe(
    Effect.flatMap((found) => {
      const responses = new Map<string, Coordination.Info>()
      for (const row of found) if (row.replyTo) responses.set(row.replyTo, row)
      if (responses.size >= requests.length || Date.now() >= deadline) return Effect.succeed(responses)
      return Effect.forEach(
        requests.filter((request) => !responses.has(request.id)),
        (request) =>
          coordination.get(request.id).pipe(
            Effect.tap((row) =>
              Effect.sync(() => {
                const receipt = receipts.get(request.id) ?? {}
                if (row?.timeRead !== undefined && receipt.seenAt === undefined) receipt.seenAt = row.timeRead
                if (row?.timeAck !== undefined && receipt.ackedAt === undefined) receipt.ackedAt = row.timeAck
                if (row?.claimedBy !== undefined && receipt.claimedBy === undefined) receipt.claimedBy = row.claimedBy
                receipts.set(request.id, receipt)
              }),
            ),
          ),
        { discard: true, concurrency: "unbounded" },
      ).pipe(
        Effect.andThen(Effect.sleep(Duration.millis(200))),
        Effect.andThen(() => pollBroadcast(coordination, requests, deadline, receipts)),
      )
    }),
  )
}

function result(action: string, output: string, metadata?: Omit<Metadata, "action">) {
  return { title: `sessions:${action}`, output, metadata: { ...(metadata ?? {}), action } }
}

function failure(output: string) {
  return { title: "sessions:error", output, metadata: { action: "error" } satisfies Metadata }
}
