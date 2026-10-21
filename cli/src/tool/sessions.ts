import { Effect, Schema } from "effect"
import * as path from "path"
import * as Tool from "./tool"
import DESCRIPTION from "./sessions.txt"
import { Identifier } from "@prioricode/core/id/id"
import { Coordination } from "@/session/coordination"
import { SessionV1 } from "@prioricode/core/v1/session"
import { Database } from "@prioricode/core/database/database"
import { FileTouch } from "@prioricode/core/file-touch"
import { FileAttribution } from "./file-attribution"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "../session/schema"
import { Session } from "@/session/session"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["query", "respond", "broadcast"]).annotate({
    description: "Coordination action to perform against sibling sessions in this project",
  }),
  target: Schema.optional(Schema.String).annotate({
    description: "Target session id for query (from your injected <cross-session-presence> roster)",
  }),
  message: Schema.optional(Schema.String).annotate({
    description: "Text for query/broadcast, or the answer for respond",
  }),
  request_id: Schema.optional(Schema.String).annotate({
    description: "ID of a note to answer or ack with respond",
  }),
  thread_id: Schema.optional(Schema.String).annotate({
    description:
      "For query: the thread_id of a prior exchange to continue that negotiation with context instead of starting a new thread.",
  }),
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "For query WITHOUT a target: ask the durable file-touch ledger who last wrote/added/deleted these files (workspace-relative or absolute paths, max 50) instead of guessing from git status.",
  }),
})

type Metadata = {
  action: string
  target?: string
  noteID?: string
  requestID?: string
  threadID?: string
  groupID?: string
  recipients?: number
}

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
    const attribution = yield* FileAttribution.Service
    const database = yield* Database.Service
    const touches = yield* FileTouch.Service

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
            error: `Session ${target} ("${found.title}") is archived and will never wake. Query a recently active session from your roster instead.`,
          }
        const idleFor = Date.now() - found.time.updated
        return { ok: true as const, session: found, stale: idleFor > STALE_AFTER_MS, idleFor }
      })

      const staleWarning = (target: string, idleFor: number) =>
        ` WARNING: session ${target} was last active ${agoLabel(idleFor)} and may be an abandoned session; ` +
        "confirm the user wants it woken before depending on a reply."

      // Local ledger answer: who last wrote each requested path, per the durable
      // file-touch attribution. Paths need no peer — the database answers.
      const attributionQuery = Effect.fn("SessionsTool.attribution")(function* (
        self: Session.Info,
        paths: ReadonlyArray<string>,
      ) {
        if (paths.length > 50) return failure("paths accepts at most 50 entries per call")
        const owned = yield* attribution.classify({
          projectID: self.projectID,
          sessionID: String(self.id),
          base: self.directory,
          paths: paths.slice(0, 50),
        })
        const now = Date.now()
        const rel = (value: string) => path.relative(self.directory, value).replaceAll("\\", "/") || value
        // Evidence: clip the owning write's stored tool-part diff so the asker
        // sees WHAT changed, not just who. Coordinates are as-of-write.
        const hunkFor = Effect.fnUntraced(function* (messageID: string, callID: string | undefined, filepath: string) {
          const parts = yield* MessageV2.parts(MessageID.make(messageID)).pipe(
            Effect.provideService(Database.Service, database),
            Effect.catch(() => Effect.succeed([] as SessionV1.Part[])),
          )
          for (const part of parts) {
            if (part.type !== "tool") continue
            if (callID !== undefined && part.callID !== callID) continue
            const meta = part.state.status === "completed" ? part.state.metadata : undefined
            const filediff = meta?.filediff as { file?: string; patch?: string } | undefined
            const patch = filediff?.patch ?? (typeof meta?.diff === "string" ? (meta.diff as string) : undefined)
            if (!patch) continue
            if (filediff?.file !== undefined && path.resolve(filediff.file) !== path.resolve(filepath)) continue
            return patch.split("\n").slice(0, 20).join("\n")
          }
          return undefined
        })
        const lines: string[] = []
        for (const item of owned) {
          if (item.status === "unrecorded") {
            lines.push(
              `- ${rel(item.path)} — NO RECORD: ${
                item.staleTouch
                  ? `the ledger's last row (${item.staleTouch.sessionID ?? "an out-of-band write"}, ${item.staleTouch.op}, ${agoLabel(now - item.staleTouch.timeUpdated)}) no longer matches the file — it changed without a fingerprinted write`
                  : "never written by a tool and never seen by the watcher (predates attribution, or the file watcher is disabled)"
              }. Likely the user's own edit or an older uncommitted change — ask the user.`,
            )
            continue
          }
          const touch = item.touch
          const provenance = touch.provenance ?? {}
          const when = agoLabel(now - touch.timeUpdated)
          if (item.status === "self") {
            lines.push(
              `- ${rel(item.path)} — you wrote this (${touch.op}, ${when}${provenance.model ? `, model ${provenance.model}` : ""})${provenance.messageID ? `; your full diff: message ${provenance.messageID}` : ""}`,
            )
            if (provenance.messageID !== undefined) {
              const excerpt = yield* hunkFor(provenance.messageID, provenance.callID, item.path)
              if (excerpt !== undefined)
                lines.push(
                  excerpt
                    .split("\n")
                    .map((row) => `    | ${row}`)
                    .join("\n"),
                )
            }
            continue
          }
          if (item.status === "external") {
            lines.push(
              `- ${rel(item.path)} — changed OUTSIDE PrioriCode tools (${when}): the user's editor, a shell command, or another process. No session authored it — ask the user if it matters to your work.`,
            )
            continue
          }
          const ownerID = touch.sessionID as string
          const owner = yield* sessions
            .get(SessionID.make(ownerID))
            .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)))
          lines.push(
            `- ${rel(item.path)} — last written by peer ${ownerID}${owner ? ` "${owner.title}"` : " (unknown session — maybe archived)"} (${touch.op}, ${when}${provenance.model ? `, model ${provenance.model}` : ""})${provenance.messageID ? `; their diff: message ${provenance.messageID}${provenance.callID ? `, call ${provenance.callID}` : ""}` : ""}. Query the owner (action "query", target ${ownerID}) about whether it is finished and meant to ship — do NOT exclude it or absorb it on assumption.`,
          )
          if (provenance.messageID !== undefined) {
            const excerpt = yield* hunkFor(provenance.messageID, provenance.callID, item.path)
            if (excerpt !== undefined)
              lines.push(
                excerpt
                  .split("\n")
                  .map((row) => `    | ${row}`)
                  .join("\n"),
              )
          }
        }
        const mine = yield* touches.recent({
          projectID: self.projectID,
          sessionIDs: [String(self.id)],
          withinMs: 24 * 60 * 60_000,
          limit: 100,
        })
        const minePaths = new Set(mine.map((item) => item.path))
        const ownHint =
          minePaths.size > 0
            ? `Your own recent ledger writes: ${minePaths.size} path(s), latest ${agoLabel(now - mine[0]!.timeUpdated)}.`
            : "You have no ledger-recorded writes in the last 24h."
        return result(
          "query",
          [
            `File-touch attribution for ${owned.length} path(s) (durable ledger of fingerprinted writes + watcher-recorded external changes):`,
            ownHint,
            ...lines,
            "",
            "Rule: peer-owned → query the owner before you commit or stage around it; external/unrecorded → ask the user. Never silently narrow a ship to your own subset, and never commit a peer's work-in-progress without its OK. A direct user instruction to ship overrides this rule.",
          ].join("\n"),
        )
      })

      // Fire-and-forget: the note is durable and the recipient's owner answers
      // at its own turn boundary (idle recipients are woken by the watcher).
      // The reply arrives in YOUR context as an injected note — never poll for it.
      const query = Effect.fn("SessionsTool.query")(function* (
        self: Session.Info,
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context<Metadata>,
      ) {
        if (params.paths !== undefined && params.paths.length > 0) {
          if (params.target) return failure("paths is a local ledger query — omit target (and message) to use it")
          return yield* attributionQuery(self, params.paths)
        }
        const target = params.target
        const message = params.message
        if (!target) return failure("query requires a target session id")
        if (!message) return failure("query requires a message")
        const resolved = yield* resolveTarget(target)
        if (!resolved.ok) return failure(resolved.error)
        const guard = yield* coordination.guardNote({
          fromSession: self.id,
          toSession: SessionID.make(target),
          kind: "request",
          body: message,
        })
        if (guard.blocked) return failure(guard.blocked)
        const note = yield* coordination.post({
          projectID: self.projectID,
          kind: "request",
          fromSession: self.id,
          toSession: SessionID.make(target),
          body: message,
          originMessageId: ctx.messageID,
          ...(ctx.callID !== undefined ? { originCallId: ctx.callID } : {}),
          ...(params.thread_id ? { threadId: params.thread_id } : {}),
        })
        return result(
          "query",
          `Note ${note.id} queued in ${target} ("${resolved.session.title}")'s inbox. ` +
            "An idle target wakes within seconds to answer; a busy target answers at its next step boundary. " +
            `Do not wait or re-query: the reply arrives in your context as [reply ... to your earlier note ${note.id}]. ` +
            "Every note you receive owes exactly one respond — a short ack is a valid answer." +
            (guard.warning ?? "") +
            (resolved.stale ? staleWarning(target, resolved.idleFor) : ""),
          { target, noteID: note.id, requestID: note.id, ...(note.threadId ? { threadID: note.threadId } : {}) },
        )
      })

      // The universal reply+ACK: one respond per note, for answers AND plain
      // acknowledgements. Only the session a note was addressed to may respond
      // to it; a respond can never itself be responded to (its kind is not
      // acceptable here), so reply chains terminate at depth two by structure.
      const respond = Effect.fn("SessionsTool.respond")(function* (
        self: Session.Info,
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context<Metadata>,
      ) {
        const noteID = params.request_id
        if (!noteID) return failure("respond requires request_id")
        const answer = params.message
        if (!answer) return failure("respond requires a message (the answer or ack)")
        const note = yield* coordination.get(noteID)
        if (!note || (note.kind !== "request" && note.kind !== "message"))
          return failure(`No query/announce note with id ${noteID} — only notes addressed to you can be answered`)
        if (!note.toSession) return failure(`Note ${noteID} is not addressed to a session`)
        if (self.id !== note.toSession)
          return failure(
            `Note ${noteID} is addressed to ${note.toSession}, not to your session — only the recipient session may answer it.`,
          )
        const existing = yield* coordination.responsesTo(noteID)
        if (existing.length > 0)
          return failure(
            `Note ${noteID} was already responded to. To correct or extend your answer, send a new query referencing the note id — never a second respond.`,
          )
        const response = yield* coordination.post({
          projectID: note.projectID,
          kind: "response",
          fromSession: note.toSession,
          toSession: note.fromSession,
          body: answer,
          replyTo: noteID,
          originMessageId: ctx.messageID,
          ...(ctx.callID !== undefined ? { originCallId: ctx.callID } : {}),
          ...(note.threadId ? { threadId: note.threadId } : {}),
          ...(note.groupId ? { groupId: note.groupId } : {}),
        })
        // Settling the target row's stamps keeps the lifecycle honest: a note
        // answered before it was ever injected still reads as delivered+acked.
        yield* coordination.markRead([noteID])
        yield* coordination.markAck([noteID])
        return result(
          "respond",
          `Response delivered to ${note.fromSession} (referencing note ${noteID}). It arrives in that session's context as a reply note.`,
          {
            target: note.fromSession,
            requestID: noteID,
            noteID: response.id,
            ...(note.threadId ? { threadID: note.threadId } : {}),
          },
        )
      })

      // Fire-and-forget fan-out: one query row per live root peer sharing a
      // group id, so answers/objections attribute back to this broadcast. No
      // waiting, no gate — peers that object will query you; proceed and let
      // objections arrive. Unanswered rows escalate to the human after the
      // normal deadline window.
      const broadcast = Effect.fn("SessionsTool.broadcast")(function* (
        self: Session.Info,
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context<Metadata>,
      ) {
        const message = params.message
        if (!message) return failure("broadcast requires a message")
        const siblings = yield* sessions.list({ limit: 100, roots: true })
        const now = Date.now()
        const active: Session.Info[] = []
        const skipped: string[] = []
        for (const peer of siblings) {
          if (peer.id === self.id || peer.time.archived) continue
          const idleFor = now - peer.time.updated
          if (idleFor > STALE_AFTER_MS) {
            skipped.push(`${peer.id} (stale, ${agoLabel(idleFor)})`)
            continue
          }
          active.push(peer)
        }
        if (active.length === 0)
          return result(
            "broadcast",
            `No live peers to announce to${skipped.length > 0 ? ` (skipped: ${skipped.join(", ")})` : ""}. Nothing is waiting on you.`,
            { recipients: 0 },
          )
        const groupID = Identifier.ascending("coordination")
        const recipients: Coordination.Info[] = []
        const blocked: string[] = []
        for (const peer of active) {
          const guard = yield* coordination.guardNote({
            fromSession: self.id,
            toSession: peer.id,
            kind: "request",
            body: message,
          })
          if (guard.blocked) {
            blocked.push(`${peer.id}: ${guard.blocked}`)
            continue
          }
          recipients.push(
            yield* coordination.post({
              projectID: self.projectID,
              kind: "request",
              fromSession: self.id,
              toSession: peer.id,
              body: `[broadcast] ${message}`,
              groupId: groupID,
              originMessageId: ctx.messageID,
              ...(ctx.callID !== undefined ? { originCallId: ctx.callID } : {}),
            }),
          )
        }
        if (recipients.length === 0) return failure(`Broadcast blocked for every peer: ${blocked.join(" | ")}`)
        return result(
          "broadcast",
          [
            `Announcement ${groupID} queued for ${recipients.length} live peer(s): ${recipients
              .map((row) => row.toSession)
              .join(", ")}.`,
            ...(blocked.length > 0 ? [`Blocked (not sent): ${blocked.join(" | ")}`] : []),
            ...(skipped.length > 0 ? [`Skipped: ${skipped.join(", ")}`] : []),
            "",
            "This does not wait for answers: idle peers wake and ack or object, busy peers see it at their next boundary. " +
              "Proceed with the shared-state work; objections arrive in your context as queries referencing the broadcast — " +
              "handle them as they land. Unanswered peers escalate to the user after the normal window.",
          ].join("\n"),
          { groupID, recipients: recipients.length },
        )
      })

      switch (params.action) {
        case "query":
          return yield* query(self, params, ctx)
        case "respond":
          return yield* respond(self, params, ctx)
        case "broadcast":
          return yield* broadcast(self, params, ctx)
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

function result(action: string, output: string, metadata?: Omit<Metadata, "action">) {
  return { title: `sessions:${action}`, output, metadata: { ...(metadata ?? {}), action } }
}

function failure(output: string) {
  return { title: "sessions:error", output, metadata: { action: "error" } satisfies Metadata }
}
