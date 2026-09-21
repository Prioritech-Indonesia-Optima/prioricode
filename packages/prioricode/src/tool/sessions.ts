import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./sessions.txt"
import { Coordination } from "@/session/coordination"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionID } from "../session/schema"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["discover", "claim", "release", "send", "ask", "respond"]).annotate({
    description: "Coordination action to perform against sibling sessions in this project",
  }),
  target: Schema.optional(Schema.String).annotate({
    description: "Target session ID for send/ask",
  }),
  message: Schema.optional(Schema.String).annotate({
    description: "Coordination text for send/ask, or the answer for respond",
  }),
  request_id: Schema.optional(Schema.String).annotate({
    description: "ID of a pending request to answer with respond (from discover or an incoming request)",
  }),
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "File paths to claim or release (claim/release)",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "For ask: maximum seconds to wait for a response. Defaults to 60, capped at 300.",
  }),
})

type Metadata = {
  action: string
  target?: string
  requestID?: string
  collisions?: string[]
}

const DEFAULT_TIMEOUT_SECONDS = 60
const MAX_TIMEOUT_SECONDS = 300
const STALE_AFTER_MS = 1000 * 60 * 60 * 72
const RECENT_DELIVERED_MS = 1000 * 60 * 30

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
        return failure("a coordination responder may only call action \"respond\"")

      yield* ctx.ask({
        permission: "sessions",
        patterns: [params.action],
        always: ["*"],
        metadata: { action: params.action, target: params.target },
      })

      const discover = Effect.fn("SessionsTool.discover")(function* (self: Session.Info) {
        const [siblings, statusMap, otherClaims, unread, delivered, sent] = yield* Effect.all(
          [
            sessions.list({ limit: 100, roots: true }),
            status.list(),
            coordination.claims({ projectID: self.projectID, exceptSession: self.id }),
            coordination.inbox({ sessionID: self.id, kinds: Coordination.CLAIM_KINDS, unreadOnly: true }),
            coordination.deliveredWithin({
              sessionID: self.id,
              kinds: Coordination.CLAIM_KINDS,
              withinMs: RECENT_DELIVERED_MS,
            }),
            coordination.sentBy({ sessionID: self.id, withinMs: RECENT_DELIVERED_MS }),
          ],
          { concurrency: "unbounded" },
        )
        const claimsBySession = new Map<string, string[]>()
        for (const claim of otherClaims) {
          const list = claimsBySession.get(claim.fromSession) ?? []
          list.push(claim.body)
          claimsBySession.set(claim.fromSession, list)
        }
        // Receipt ledger: status of what this session recently SENT — the
        // sender-side truth about whether peers saw/answered the traffic.
        const answeredByRequest = new Map<string, Coordination.Info>()
        if (sent.length > 0) {
          const responses = yield* coordination.responsesFor(sent.map((item) => item.id))
          for (const response of responses) if (response.replyTo) answeredByRequest.set(response.replyTo, response)
        }
        const clip = (value: string, max = 80) => (value.length > max ? value.slice(0, max) + "…" : value)
        const peers = siblings.filter((session) => session.id !== self.id && !session.time.archived)
        const now = Date.now()
        const lines = [
          `Project ${self.projectID}. ${peers.length} sibling session(s), most recently active first. ` +
            "Coordinate only with recently active sessions; STALE ones are likely abandoned and should not be woken unless the user explicitly names one.",
          `Presence is ambient: a read-only roster of your peers is injected into your context every turn, so you do not need to call discover just to know who is here. Use discover to re-read details (claims, note bodies) or to act on a peer.`,
          unread.length > 0
            ? `You have ${unread.length} UNREAD coordination item(s) waiting to be delivered next turn:\n  ` +
              unread
                .map(
                  (item) =>
                    `[${item.kind}${item.kind === "request" ? ` id=${item.id}` : ""}] from ${item.fromSession}: ${item.body}`,
                )
                .join("\n  ")
            : `No unread coordination items.`,
          delivered.length > 0
            ? `\nAlready delivered into your context within the last ${Math.round(RECENT_DELIVERED_MS / 60_000)}m ` +
              `(read them above in your system context; do NOT re-run discover expecting them to be "unread" — delivery consumes them):\n  ` +
              delivered
                .map(
                  (item) =>
                    `[delivered ${item.kind}${item.kind === "request" ? ` id=${item.id}` : ""}] from ${item.fromSession}: ${item.body}`,
                )
                .join("\n  ")
            : "",
          sent.length > 0
            ? `\nNotes you sent in the last ${Math.round(RECENT_DELIVERED_MS / 60_000)}m — these are your delivery receipts:\n  ` +
              sent
                .map((item) => {
                  const answer = answeredByRequest.get(item.id)
                  const status = answer
                    ? `ANSWERED: "${clip(answer.body)}"`
                    : item.timeAck !== undefined
                      ? "received and processed by the peer"
                      : item.timeRead !== undefined
                        ? `seen by the peer ${agoLabel(now - (item.timeRead ?? 0))}, no reply yet`
                        : "queued — the peer has not seen it yet"
                  return `[${item.kind}${item.kind === "request" ? ` id=${item.id}` : ""} to ${item.toSession}] ${status}`
                })
                .join("\n  ")
            : "",
        ]
        for (const peer of peers) {
          const busy = statusMap.get(peer.id)?.type === "busy"
          const claims = claimsBySession.get(peer.id) ?? []
          const stale = now - peer.time.updated > STALE_AFTER_MS
          lines.push(
            `- ${peer.id} "${peer.title}" agent=${peer.agent ?? "default"} ${busy ? "BUSY" : "idle"} ` +
              `last active ${agoLabel(now - peer.time.updated)}${stale ? " STALE" : ""}` +
              (claims.length > 0 ? ` claims: ${claims.join(", ")}` : ""),
          )
        }
        if (peers.length === 0) lines.push("No other sessions are working on this project.")
        return result("discover", lines.join("\n"), { collisions: [...claimsBySession.keys()] })
      })

      const claim = Effect.fn("SessionsTool.claim")(function* (self: Session.Info, paths: ReadonlyArray<string>) {
        if (paths.length === 0) return result("claim", "No paths provided.")
        const [mine, others] = yield* Effect.all([
          coordination.myClaims(self.id),
          coordination.claims({ projectID: self.projectID, exceptSession: self.id }),
        ])
        const owned = new Set(mine.map((item) => item.body))
        const collisions = others.filter((item) => paths.includes(item.body))
        yield* Effect.forEach(
          paths.filter((path) => !owned.has(path)),
          (path) => coordination.post({ projectID: self.projectID, kind: "claim", fromSession: self.id, body: path }),
          { discard: true },
        )
        const collisionText =
          collisions.length > 0
            ? ` WARNING: ${collisions.map((c) => `${c.body} (also claimed by ${c.fromSession})`).join(", ")}`
            : ""
        return result("claim", `Claimed ${paths.length} path(s).${collisionText}`, {
          collisions: collisions.map((c) => c.body),
        })
      })

      const resolveTarget = Effect.fn("SessionsTool.resolveTarget")(function* (target: string) {
        const found = yield* sessions
          .get(SessionID.make(target))
          .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)))
        if (!found)
          return {
            ok: false as const,
            error: `No session "${target}" exists in this project. Run discover first — never guess or invent session ids.`,
          }
        if (found.time.archived)
          return {
            ok: false as const,
            error: `Session ${target} ("${found.title}") is archived and will never wake. Message a recently active session from discover instead.`,
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
            "Receipt: discover lists this note as seen/processed once the peer's context has consumed it." +
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
        const request = yield* coordination.post({
          projectID: self.projectID,
          kind: "request",
          fromSession: self.id,
          toSession: SessionID.make(target),
          body: message,
        })
        const seconds = Math.min(params.timeout ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS)
        const receipt = { seenAt: undefined as number | undefined, ackedAt: undefined as number | undefined }
        const response = yield* pollResponse(coordination, request.id, Date.now() + seconds * 1000, receipt)
        if (!response)
          return result(
            "ask",
            `Request ${request.id} got no reply within ${seconds}s — ` +
              (receipt.ackedAt
                ? `the peer received and processed it ${agoLabel(Date.now() - receipt.ackedAt)} but chose not to answer. `
                : receipt.seenAt
                  ? `the peer received it at the edge of its context but has not finished the step that saw it. `
                  : `the peer never saw it (likely deep in one long tool call, or abandoned). `) +
              "Do not re-ask in a loop: it stays queued, the answer (or a responder's reply) will be delivered to your context when it lands." +
              (resolved.stale ? staleWarning(target, resolved.idleFor) : ""),
            { target, requestID: request.id },
          )
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
        if (delegate && (yield* coordination.responsesTo(requestID)).length > 0)
          return failure(`Request ${requestID} was already answered — the main agent may correct it directly if needed.`)

        const body = delegate
          ? `[answered by ${request.toSession}'s coordination responder while its main agent was mid-turn; treat as best-effort] ${answer}`
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
              `Your coordination responder answered a peer request on your behalf while you were mid-turn. ` +
              `Request ${requestID} from session ${requester} asked: """${request.body}""". ` +
              `Your responder replied: """${answer}""". ` +
              `That reply was generated from a snapshot of your session and may be incomplete or wrong — if so, send a corrected answer with the sessions tool: action "respond", request_id "${requestID}" (you may always correct your own responder). Otherwise ignore this record; no action is needed.`,
          })
        return result("respond", `Response delivered to ${requester}${delegate ? " (delegated by your responder)" : ""}.`, {
          target: requester,
          requestID,
        })
      })

      switch (params.action) {
        case "discover":
          return yield* discover(self)
        case "claim":
          return yield* claim(self, params.paths ?? [])
        case "release":
          yield* coordination.releaseClaims({ sessionID: self.id, paths: params.paths ?? [] })
          return result("release", `Released ${params.paths?.length ?? 0} claim(s).`)
        case "send":
          return yield* send(self, params)
        case "ask":
          return yield* ask(self, params)
        case "respond":
          return yield* respond(self, params)
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
  receipt: { seenAt?: number; ackedAt?: number },
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
            }),
          ),
        )
        .pipe(Effect.andThen(pollResponse(coordination, requestID, deadline, receipt)))
    }),
  )
}

function result(action: string, output: string, metadata?: Omit<Metadata, "action">) {
  return { title: `sessions:${action}`, output, metadata: { ...(metadata ?? {}), action } }
}

function failure(output: string) {
  return { title: "sessions:error", output, metadata: { action: "error" } satisfies Metadata }
}
