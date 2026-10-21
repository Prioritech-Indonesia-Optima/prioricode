import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Cause, Duration, Effect, Layer, Schedule, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionV1 } from "@prioricode/core/v1/session"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { SessionPresence } from "./presence"
import { SessionPrompt } from "./prompt"
import { Coordination } from "./coordination"

// A claimed-but-unacked note older than this is treated as lost to a crash or
// an errored/compaction-rejected request and is re-queued. Must exceed the
// worst-case single model step (provider retries with header-driven delays can
// legitimately take many minutes), so 15 minutes is the floor.
const ACK_RECOVERY_GRACE_MS = 15 * 60_000
// Throttle for wakes triggered ONLY by reply rows, to keep two LLM sessions
// from ping-ponging turn on turn over answered requests.
const WAKE_COOLDOWN_MS = 10_000
// Session-init announce bounds. A root session announces itself once, on the
// sweep after its first real user message, to every live peer.
const ANNOUNCE_STALE_MS = 72 * 60 * 60_000
const ANNOUNCE_PEER_CAP = 25
const ANNOUNCE_GIST_CHARS = 300
const ANNOUNCE_SCAN_LIMIT = 20
// Only sessions BORN in this window announce — the upgrade cohort of pre-existing
// live sessions stays silent instead of flooding peers with stale "joinings".
const ANNOUNCE_BIRTH_MS = 24 * 60 * 60_000
const FORK_TITLE_RE = /\s\(fork #\d+\)$/

/** Collapse the first user message's real text to a bounded one-line gist. */
function firstUserGist(messages: ReadonlyArray<SessionV1.WithParts>): string | undefined {
  for (const message of messages) {
    if (message.info.role !== "user") continue
    const text = message.parts
      .filter((part): part is SessionV1.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
      .map((part) => part.text.trim())
      .filter((value) => value.length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
    if (!text) continue
    return text.length > ANNOUNCE_GIST_CHARS ? `${text.slice(0, ANNOUNCE_GIST_CHARS)}…` : text
  }
  return undefined
}

export interface Interface {
  /**
   * One sweep: re-queue notes that were injected but never acked (crash/errored
   * turn), escalate and expire overdue unanswered queries, and for every
   * durably idle session with unread wake-kind notes start exactly one
   * coalesced turn. Returns the number of sessions woken. Exposed for
   * deterministic testing.
   */
  readonly sweep: () => Effect.Effect<number>
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/CoordinationWatcher") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const presence = yield* SessionPresence.Service
    const coordination = yield* Coordination.Service
    const prompt = yield* SessionPrompt.Service

    // Per-process throttle for wakes triggered ONLY by reply rows, to keep two
    // chatty sessions from ping-ponging full model turns at each other. Query
    // wakes (a peer needs an answer) are never throttled.
    const lastWakeAt = new Map<SessionID, number>()
    // Roots whose announce has already been settled in this process (posted,
    // skipped as fork/stale/legacy, or covered by the durable group check).
    const announceSettled = new Set<SessionID>()
    const sweep = Effect.fn("CoordinationWatcher.sweep")(function* () {
      const ctx = yield* InstanceState.context
      const busy = yield* status.list()
      const all = yield* sessions.list({ limit: 200 })
      // Root sessions only: subagent/child sessions have no user attached, must
      // not be woken or recovered directly, and never appear as peers.
      const roots = all.filter(
        (session) => !session.time.archived && session.directory === ctx.directory && !session.parentID,
      )
      // Strictly idle = absent from the status map. A session in provider-retry
      // is still present and counts as non-idle here, so recovery never
      // unclaims rows an in-flight turn (possibly in another process) may ack.
      const fullyIdle = roots.filter((session) => !busy.has(session.id))
      // Recovery first: notes that were claimed for injection but never acked —
      // lost to a crash, an errored request, or a compaction rejection — are
      // re-queued once they have aged past the grace, so the wake pass below
      // (or the session's next turn) can deliver them again. Fresh unacked
      // claims belong to a live step and are left alone.
      yield* coordination.unclaimStaleUnacked({
        sessionIDs: fullyIdle.map((session) => session.id),
        cutoffMs: Date.now() - ACK_RECOVERY_GRACE_MS,
      })
      // Durable, cross-process idle set: a session genuinely busy in ANY process
      // (fresh heartbeat) is excluded, so we never double-run or takeover-steal a
      // peer another terminal is actively working.
      const idleSince = yield* presence.idleSince(roots.map((session) => session.id))
      // Keep locally-busy sessions' heartbeats fresh so a crash (no onIdle) makes
      // their busy row go stale after the grace, rather than reading idle forever.
      yield* presence.touch([...busy.keys()])
      // Session-init announce: a root born in this sweep's window tells every
      // live peer it joined — ONE ambient `message` row per (newcomer, peer)
      // sharing group `ann:<newcomer>`. Idempotent at three levels: an
      // in-process set (fast path), the durable group check (across restarts),
      // and the deterministic per-peer primary key (across racing processes —
      // postOnce never defects the sweep). Announce rows never wake anyone and
      // never escalate (kind `message` is outside both filters).
      {
        const now = Date.now()
        for (const session of roots) {
          if (announceSettled.has(session.id)) continue
          const bornRecently = now - session.time.created <= ANNOUNCE_BIRTH_MS
          const forked = FORK_TITLE_RE.test(session.title)
          if (!bornRecently || forked) {
            announceSettled.add(session.id)
            continue
          }
          const groupID = `ann:${session.id}`
          if (yield* coordination.groupExists(groupID)) {
            announceSettled.add(session.id)
            continue
          }
          const history = yield* sessions
            .messages({ sessionID: session.id, limit: ANNOUNCE_SCAN_LIMIT })
            .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed([] as SessionV1.WithParts[])))
          const gist = firstUserGist(history)
          if (gist === undefined) continue // no real user message yet — retry next sweep
          announceSettled.add(session.id)
          const peers = roots
            .filter((peer) => peer.id !== session.id && now - peer.time.updated <= ANNOUNCE_STALE_MS)
            .sort((a, b) => b.time.updated - a.time.updated)
            .slice(0, ANNOUNCE_PEER_CAP)
          for (const peer of peers) {
            yield* coordination.postOnce({
              id: `ann:${session.id}:${peer.id}`,
              projectID: session.projectID,
              kind: "message",
              fromSession: session.id,
              toSession: peer.id,
              body: `[announce] session ${session.id} "${session.title}" joined this workspace. First task: "${gist}"`,
              groupId: groupID,
            })
          }
        }
      }
      // Escalation + expiry passes: an unanswered request past its deadline is
      // escalated once (a passive `record` tells the asker a human has been
      // surfaced), then expires once more past the grace (terminal — no claim
      // path touches it again). Records never wake, so this cannot storm.
      for (const request of yield* coordination.escalateDue()) {
        yield* coordination.post({
          projectID: request.projectID,
          kind: "record",
          fromSession: request.toSession ?? request.fromSession,
          toSession: request.fromSession,
          body: `Your query ${request.id} to ${request.toSession} has gone unanswered past its deadline and was escalated — a human has been notified. You may continue without it or follow up directly.`,
        })
      }
      for (const request of yield* coordination.expireDue()) {
        yield* coordination.post({
          projectID: request.projectID,
          kind: "record",
          fromSession: request.toSession ?? request.fromSession,
          toSession: request.fromSession,
          body: `Your query ${request.id} to ${request.toSession} has expired unanswered. No further reply will arrive; re-query only if it still matters.`,
        })
      }
      let woken = 0
      for (const session of roots.filter((s) => idleSince.has(s.id))) {
        // Detect without claiming: the turn-boundary claimUnread inside runLoop is the
        // single delivery point, so a note is only marked read when it is actually
        // injected into the model context. A coalesced wake therefore can never
        // claim-and-drop a note the model never saw.
        const unread = (sessionID: SessionID) =>
          coordination.inbox({ sessionID, kinds: Coordination.WAKE_KINDS, unreadOnly: true })
        let pending = yield* unread(session.id)
        if (pending.length === 0) continue
        if (
          pending.every((item) => item.kind === "response") &&
          Date.now() - (lastWakeAt.get(session.id) ?? 0) < WAKE_COOLDOWN_MS
        )
          continue
        woken++
        // Loop so a note that arrives mid-turn gets its own follow-up turn. A
        // wake that FAILS (no model, denied permission) must NOT be retried in
        // this sweep — the note stays unread, so retrying would spin forever.
        while (pending.length > 0) {
          lastWakeAt.set(session.id, Date.now())
          const woke = yield* prompt
            .prompt({
              sessionID: session.id,
              parts: [{ type: "text", synthetic: true, display: "system", text: Coordination.wakePrompt }],
            })
            .pipe(
              Effect.as(true),
              Effect.catchCause((cause) =>
                Effect.logWarning("coordination wake failed", {
                  "session.id": session.id,
                  cause: Cause.pretty(cause),
                }).pipe(Effect.as(false)),
              ),
            )
          if (!woke) break
          pending = yield* unread(session.id)
        }
      }
      return woken
    })

    const state = yield* InstanceState.make<void>(
      Effect.fn("CoordinationWatcher.state")(function* () {
        yield* Effect.logInfo("coordination watcher started", { directory: (yield* InstanceState.context).directory })
        yield* Effect.addFinalizer(() => Effect.logInfo("coordination watcher stopped"))
        yield* sweep().pipe(
          Effect.catchCause((cause) => Effect.logWarning("coordination sweep failed", { cause: Cause.pretty(cause) })),
          Effect.repeat(Schedule.spaced(Duration.seconds(2))),
          Effect.delay(Duration.seconds(2)),
          Effect.forkScoped,
        )
      }),
    )

    const init = Effect.fn("CoordinationWatcher.init")(function* () {
      yield* InstanceState.get(state)
    })

    return Service.of({ sweep, init })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Session.node, SessionStatus.node, SessionPresence.node, Coordination.node, SessionPrompt.node],
})

export * as CoordinationWatcher from "./coordination-watcher"
