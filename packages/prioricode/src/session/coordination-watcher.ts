import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Cause, Duration, Effect, Layer, Schedule, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
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
// Busy-session responder (see the busy pass): a request younger than this is
// left for the main agent to see at its own next step boundary; only aged
// requests are handed to an out-of-band responder. Kept below the sessions
// tool's default ask timeout (60s) so delegated answers arrive while the
// asker is still waiting.
const RESPONDER_GRACE_MS = 20_000
const RESPONDER_BATCH_LIMIT = 10
const RESPONDERS_PER_SWEEP = 2

export interface Interface {
  /**
   * One wake pass: for every idle session in this instance's directory that has
   * unread coordination notes, surface them in a turn; re-queue notes that were
   * injected but never acked; and, for sessions that are mid-turn with aged
   * unanswered requests, hand those requests to a responder child session so
   * peers are not blocked on a busy agent's next boundary. Returns the number
   * of sessions woken (responder spawns are not wakes). Exposed for
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
    const coordination = yield* Coordination.Service
    const prompt = yield* SessionPrompt.Service

    // Per-process throttle for response-triggered wakes. Replies to a timed-out
    // ask now wake the asker; without a cooldown two chatty sessions could ping-
    // pong full model turns at each other. Message/request wakes keep the
    // historical always-wake behavior.
    const lastWakeAt = new Map<SessionID, number>()

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
      const idle = roots.filter((session) => busy.get(session.id)?.type !== "busy")
      let woken = 0
      for (const session of idle) {
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
        // Loop so a note that arrives mid-turn gets its own follow-up turn.
        while (pending.length > 0) {
          lastWakeAt.set(session.id, Date.now())
          yield* prompt
            .prompt({
              sessionID: session.id,
              parts: [{ type: "text", synthetic: true, text: Coordination.wakePrompt }],
            })
            .pipe(
              Effect.ignore,
              Effect.catchCause((cause) =>
                Effect.logWarning("coordination wake failed", {
                  "session.id": session.id,
                  cause: Cause.pretty(cause),
                }),
              ),
            )
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
  deps: [Session.node, SessionStatus.node, Coordination.node, SessionPrompt.node],
})

export * as CoordinationWatcher from "./coordination-watcher"
