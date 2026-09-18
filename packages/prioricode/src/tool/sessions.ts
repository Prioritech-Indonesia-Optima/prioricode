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

      yield* ctx.ask({
        permission: "sessions",
        patterns: [params.action],
        always: ["*"],
        metadata: { action: params.action, target: params.target },
      })

      const discover = Effect.fn("SessionsTool.discover")(function* (self: Session.Info) {
        const [siblings, statusMap, otherClaims, unread, delivered] = yield* Effect.all(
          [
            sessions.list({ limit: 100, roots: true }),
            status.list(),
            coordination.claims({ projectID: self.projectID, exceptSession: self.id }),
            coordination.inbox({ sessionID: self.id, kinds: ["message", "request"], unreadOnly: true }),
            coordination.deliveredWithin({
              sessionID: self.id,
              kinds: ["message", "request"],
              withinMs: RECENT_DELIVERED_MS,
            }),
          ],
          { concurrency: "unbounded" },
        )
        const claimsBySession = new Map<string, string[]>()
        for (const claim of otherClaims) {
          const list = claimsBySession.get(claim.fromSession) ?? []
          list.push(claim.body)
          claimsBySession.set(claim.fromSession, list)
        }
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
          `Message delivered to ${target} ("${resolved.session.title}"). ` +
            "It will wake within seconds, read it, and tell the user your session triggered it." +
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
        const response = yield* pollResponse(coordination, request.id, Date.now() + seconds * 1000)
        if (!response)
          return result(
            "ask",
            `Request ${request.id} delivered to ${target} but no response within ${seconds}s. It stays queued; the peer can respond later.` +
              (resolved.stale ? staleWarning(target, resolved.idleFor) : ""),
            { target, requestID: request.id },
          )
        yield* coordination.markRead([response.id])
        return result("ask", `Response from ${target} (request ${request.id}): ${response.body}`, {
          target,
          requestID: request.id,
        })
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
        const requester = request.fromSession
        yield* coordination.post({
          projectID: request.projectID,
          kind: "response",
          fromSession: self.id,
          toSession: requester,
          body: answer,
          replyTo: requestID,
        })
        yield* coordination.markRead([requestID])
        return result("respond", `Response delivered to ${requester}.`, { target: requester, requestID })
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
): Effect.Effect<Coordination.Info | undefined> {
  return coordination.responsesTo(requestID).pipe(
    Effect.flatMap((found) => {
      if (found.length > 0) return Effect.succeed(found[0])
      if (Date.now() >= deadline) return Effect.succeed(undefined)
      return Effect.sleep("1 seconds").pipe(Effect.andThen(pollResponse(coordination, requestID, deadline)))
    }),
  )
}

function result(action: string, output: string, metadata?: Omit<Metadata, "action">) {
  return { title: `sessions:${action}`, output, metadata: { ...(metadata ?? {}), action } }
}

function failure(output: string) {
  return { title: "sessions:error", output, metadata: { action: "error" } satisfies Metadata }
}
