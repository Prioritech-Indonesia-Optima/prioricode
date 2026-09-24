import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Cause, Duration, Effect, Layer, Schedule, Scope, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionV1 } from "@prioricode/core/v1/session"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { SessionPrompt } from "./prompt"
import { Coordination } from "./coordination"
import { Todo } from "./todo"

// A claimed-but-unacked note older than this is treated as lost to a crash or
// an errored/compaction-rejected request and is re-queued. Must exceed the
// worst-case single model step (provider retries with header-driven delays can
// legitimately take many minutes), so 15 minutes is the floor.
const ACK_RECOVERY_GRACE_MS = 15 * 60_000
// Throttle for wakes triggered ONLY by reply rows, to keep two LLM sessions
// from ping-ponging turn on turn over answered requests.
const WAKE_COOLDOWN_MS = 10_000
// Standing-representative grace (see the unanswered pass): a request younger
// than this is left for the main agent to answer itself at its own next step
// boundary; only requests that have aged unanswered are handed to the
// responder child. Kept below the sessions tool's default ask timeout (60s)
// so delegated answers arrive while the asker is still waiting.
const RESPONDER_GRACE_MS = 20_000
const RESPONDER_BATCH_LIMIT = 10
const RESPONDERS_PER_SWEEP = 2
const RESPONDER_SNAPSHOT_MESSAGES = 10
const RESPONDER_SNAPSHOT_TODOS = 12
// Requests from a session that has not been touched this long come from an
// abandoned terminal; answering them spends model turns for nobody. Matches the
// sessions tool's STALE heuristic.
const RESPONDER_REQUESTER_STALE_MS = 72 * 60 * 60_000
// After a responder turn dies (e.g. provider down), its requests are fast-
// requeued but the parent backs off before another responder is attempted —
// otherwise every 2s sweep would respawn, clone sessions, and burn tokens
// against a broken provider.
const RESPONDER_BACKOFF_MS = 5 * 60_000

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
    const todo = yield* Todo.Service
    const flags = yield* RuntimeFlags.Service
    const scope = yield* Scope.Scope

    // Per-process throttle for response-triggered wakes. Replies to a timed-out
    // ask now wake the asker; without a cooldown two chatty sessions could ping-
    // pong full model turns at each other. Message/request wakes keep the
    // historical always-wake behavior.
    const lastWakeAt = new Map<SessionID, number>()
    // Parents with a responder child currently running (one at a time per
    // parent; cross-process duplicates are prevented by the atomic stale-claim).
    const runningResponders = new Set<SessionID>()
    // Parents whose last responder turn died; skipped until the backoff passes.
    const responderFailures = new Map<SessionID, number>()

    // Recent visible (non-synthetic) conversation of the parent, its todo
    // list, and its file claims — everything a responder is allowed to answer
    // from. The todo list is what keeps the representative's picture aligned
    // with the main agent's own plan of record.
    const responderSnapshot = Effect.fnUntraced(function* (parent: Session.Info) {
      const messages = yield* sessions
        .messages({ sessionID: parent.id, limit: RESPONDER_SNAPSHOT_MESSAGES * 3 })
        .pipe(Effect.orDie)
      const lines: string[] = []
      for (const message of messages) {
        if (message.info.role !== "user" && message.info.role !== "assistant") continue
        const text = message.parts
          .filter((part): part is SessionV1.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
          .map((part) => part.text.trim())
          .filter((value) => value.length > 0)
          .join("\n")
        if (!text) continue
        lines.push(`${message.info.role}: ${text.slice(0, 2_000)}`)
      }
      const claims = (yield* coordination.myClaims(parent.id)).map((claim) => claim.body)
      const todos = (yield* todo.get(parent.id)).slice(0, RESPONDER_SNAPSHOT_TODOS)
      return (
        (lines.length > 0 ? lines.slice(-RESPONDER_SNAPSHOT_MESSAGES).join("\n\n") : "(no visible conversation yet)") +
        "\n\nCurrent file claims: " +
        (claims.length > 0 ? claims.join(", ") : "(none)") +
        "\n\nCurrent todo list: " +
        (todos.length > 0 ? todos.map((item) => `${item.status} — ${item.content}`).join("; ") : "(none)")
      )
    })

    // Hand a session's aged unanswered requests to a hidden responder
    // child session. The claim above already gave this process exclusive
    // ownership of `requests` (exactly-once via SQL), so it doubles as the
    // cross-process spawn lease. The child runs on its own runner, fully
    // concurrent with the parent's turn — the parent is never interrupted.
    const spawnResponder = Effect.fnUntraced(function* (parent: Session.Info, requests: Coordination.Info[]) {
      runningResponders.add(parent.id)
      const snapshot = yield* responderSnapshot(parent)
      const child = yield* sessions.create({
        parentID: parent.id,
        title: `coordination responder (${parent.title})`,
        agent: "responder",
      })
      yield* Effect.logInfo("spawning coordination responder", {
        "session.id": parent.id,
        "responder.id": child.id,
        requests: requests.length,
      })
      const ids = requests.map((request) => request.id)
      yield* prompt
        .prompt({
          sessionID: child.id,
          agent: "responder",
          parts: [
            {
              type: "text",
              synthetic: true,
              text: Coordination.responderPrompt({
                parent: { id: parent.id, title: parent.title },
                requests,
                snapshot,
              }),
            },
          ],
        })
        .pipe(
          Effect.tap((result) =>
            // The child's turn died before replying: fast re-queue instead of
            // waiting out the 15-minute recovery grace, then back this parent
            // off so a broken provider cannot turn every sweep into a new
            // responder spawn. Rows the responder already answered are acked
            // and stay settled.
            result.info.role === "assistant" && !result.info.error
              ? Effect.sync(() => responderFailures.delete(parent.id)).pipe(
                  Effect.andThen(Effect.logInfo("coordination responder finished", { "responder.id": child.id })),
                )
              : Effect.sync(() => void responderFailures.set(parent.id, Date.now())).pipe(
                  Effect.andThen(coordination.unclaimUnacked(ids)),
                  Effect.asVoid,
                ),
          ),
          Effect.catchCause((cause) =>
            Effect.sync(() => void responderFailures.set(parent.id, Date.now())).pipe(
              Effect.andThen(
                Effect.logWarning("coordination responder failed", {
                  "session.id": parent.id,
                  cause: Cause.pretty(cause),
                }),
              ),
              Effect.andThen(coordination.unclaimUnacked(ids)),
              Effect.asVoid,
            ),
          ),
          Effect.ensuring(Effect.sync(() => void runningResponders.delete(parent.id))),
          Effect.ignore,
          Effect.forkIn(scope, { startImmediately: true }),
        )
    })

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
              parts: [{ type: "text", synthetic: true, display: "system", text: Coordination.wakePrompt }],
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
      // Unanswered pass: a request that has aged past the grace with nobody
      // answering it gets a reply from the session's standing responder child,
      // regardless of whether the main agent is busy or idle. The main agent
      // may still answer (or correct) at its own boundary — the atomic claim
      // plus the already-answered guard make double replies impossible from
      // the responder side, and a parent's later answer arrives as a
      // correction. Fresh requests are deliberately left for the main agent's
      // own next boundary.
      if (!flags.disableCoordinationResponder) {
        let launches = 0
        const now = Date.now()
        for (const session of roots) {
          if (launches >= RESPONDERS_PER_SWEEP) break
          if (runningResponders.has(session.id)) continue
          const failedAt = responderFailures.get(session.id)
          if (failedAt !== undefined && now - failedAt < RESPONDER_BACKOFF_MS) continue
          const leased = yield* coordination.claimUnanswered({
            sessionID: session.id,
            olderThanMs: RESPONDER_GRACE_MS,
            limit: RESPONDER_BATCH_LIMIT,
            claimToken: `${Coordination.RESPONDER_LEASE_PREFIX}${session.id}`,
          })
          if (leased.length === 0) continue
          const worthAnswering: Coordination.Info[] = []
          for (const request of leased) {
            const requester = yield* sessions
              .get(request.fromSession)
              .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)))
            if (requester && !requester.time.archived && now - requester.time.updated < RESPONDER_REQUESTER_STALE_MS) {
              worthAnswering.push(request)
              continue
            }
            // Ghost traffic from a deleted or long-abandoned session: settle the
            // ledger without spending model turns on it.
            yield* coordination.markAck([request.id])
          }
          if (worthAnswering.length === 0) continue
          launches++
          yield* spawnResponder(session, worthAnswering)
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
  deps: [Session.node, SessionStatus.node, Coordination.node, SessionPrompt.node, Todo.node, RuntimeFlags.node],
})

export * as CoordinationWatcher from "./coordination-watcher"
