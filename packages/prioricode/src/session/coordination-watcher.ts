import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Cause, Duration, Effect, Layer, Schedule, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { SessionPrompt } from "./prompt"
import { Coordination } from "./coordination"

export interface Interface {
  /**
   * One wake pass: for every idle session in this instance's directory that has
   * unread coordination notes, claim them and start a turn that surfaces them.
   * Returns the number of sessions woken. Exposed for deterministic testing.
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

    const sweep = Effect.fn("CoordinationWatcher.sweep")(function* () {
      const ctx = yield* InstanceState.context
      const busy = yield* status.list()
      const all = yield* sessions.list({ limit: 200 })
      const idle = all.filter(
        (session) =>
          !session.time.archived && session.directory === ctx.directory && busy.get(session.id)?.type !== "busy",
      )
      let woken = 0
      for (const session of idle) {
        // Detect without claiming: the turn-boundary claimUnread inside runLoop is the
        // single delivery point, so a note is only marked read when it is actually
        // injected into the model context. A coalesced wake therefore can never
        // claim-and-drop a note the model never saw.
        const unread = (sessionID: SessionID) =>
          coordination.inbox({ sessionID, kinds: ["message", "request"], unreadOnly: true })
        let pending = yield* unread(session.id)
        if (pending.length === 0) continue
        woken++
        // Loop so a note that arrives mid-turn gets its own follow-up turn.
        while (pending.length > 0) {
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
