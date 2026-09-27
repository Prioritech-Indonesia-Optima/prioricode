import { describe, expect } from "bun:test"
import { Cause } from "effect"
import { Effect, Exit, Layer } from "effect"
import { Database } from "@prioricode/core/database/database"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { EventV2 } from "@prioricode/core/event"
import { AbsolutePath } from "@prioricode/core/schema"
import { Location } from "@prioricode/core/location"
import { ProjectV2 } from "@prioricode/core/project"
import { SessionSchema } from "@prioricode/core/session/schema"
import { SessionV2 } from "@prioricode/core/session"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionProjector } from "@prioricode/core/session/projector"
import { location as locationFixture, tempLocationLayer } from "./fixture/location"
import { SessionStore } from "@prioricode/core/session/store"
import { SessionMessage } from "@prioricode/core/session/message"
import { ModelV2 } from "@prioricode/core/model"
import { ProviderV2 } from "@prioricode/core/provider"
import { Snapshot } from "@prioricode/core/snapshot"
import { testEffect } from "./lib/effect"

const sessionID = SessionSchema.ID.make("ses_operations_test")

const hasFailure = (exit: Exit.Exit<unknown, unknown>, error: { readonly _tag: string }) =>
  exit._tag === "Failure" &&
  (exit.cause as unknown as { reasons: ReadonlyArray<{ _tag: string; error?: { _tag: string } }> }).reasons.some(
    (reason) => reason._tag === "Fail" && reason.error?._tag === error._tag,
  )

const active = new Set<SessionSchema.ID>()
const wakes: SessionSchema.ID[] = []

const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set(active)),
    resume: () => Effect.void,
    wake: (id) =>
      Effect.sync(() => {
        wakes.push(id)
      }),
    interrupt: () => Effect.void,
  }),
)

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const snapshots = Snapshot.noopLayer

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const directory = AbsolutePath.make(mkdtempSync(join(tmpdir(), "prioricode-ops-")))
const locationRef = Location.Ref.make({ directory })
const location = Layer.succeed(Location.Service, Location.Service.of(locationFixture(locationRef)))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [SessionExecution.node, execution],
      [ProjectV2.node, projects],
      [Snapshot.node, snapshots],
      [Location.node, location],
    ],
  ),
)

const createSession = Effect.gen(function* () {
  const sessions = yield* SessionV2.Service
  return yield* sessions.create({ location: locationRef, id: sessionID })
})

describe("SessionV2 operations while in use", () => {
  it.effect("admission and switch operations remain safe while a drain is active", () =>
    Effect.gen(function* () {
      yield* createSession
      active.add(sessionID)
      const sessions = yield* SessionV2.Service

      const admitted = yield* sessions.prompt({
        sessionID,
        prompt: { text: "steer while busy" },
        delivery: "steer",
        resume: false,
      })
      expect(admitted.sessionID).toBe(sessionID)
      yield* sessions.switchAgent({ sessionID, agent: "plan" })
      yield* sessions.switchModel({
        sessionID,
        model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("test") },
      })
      expect(wakes).toEqual([])

      active.delete(sessionID)
      yield* sessions.prompt({ sessionID, prompt: { text: "wake on idle" }, delivery: "queue" })
      expect(wakes).toEqual([sessionID])
    }),
  )

  it.effect("idle-only operations reject with BusyError while the Session drains", () =>
    Effect.gen(function* () {
      yield* createSession
      active.add(sessionID)
      const sessions = yield* SessionV2.Service

      const busy = new SessionV2.BusyError({ sessionID })
      const stage = yield* Effect.exit(
        sessions.revert.stage({
          sessionID,
          messageID: SessionMessage.ID.make("msg_missing_boundary"),
        }),
      )
      expect(hasFailure(stage, busy)).toBe(true)
      const clear = yield* Effect.exit(sessions.revert.clear(sessionID))
      expect(hasFailure(clear, busy)).toBe(true)
      const commit = yield* Effect.exit(sessions.revert.commit(sessionID))
      expect(hasFailure(commit, busy)).toBe(true)
      const compact = yield* Effect.exit(sessions.compact({ sessionID }))
      expect(hasFailure(compact, new SessionV2.BusyError({ sessionID }))).toBe(true)

      active.delete(sessionID)
    }),
  )

  it.effect("idle-only operations proceed once the Session settles", () =>
    Effect.gen(function* () {
      yield* createSession
      const sessions = yield* SessionV2.Service

      // No staged revert: commit and clear are durable no-ops when idle.
      yield* sessions.revert.commit(sessionID)
      yield* sessions.revert.clear(sessionID)
      // Compact remains an unimplemented stub once existence and idle checks pass.
      const compact = yield* Effect.exit(sessions.compact({ sessionID }))
      expect(hasFailure(compact, new SessionV2.OperationUnavailableError({ operation: "compact" }))).toBe(true)
    }),
  )

  it.effect("existence is checked before busy state", () =>
    Effect.gen(function* () {
      const missing = SessionSchema.ID.make("ses_operations_missing")
      active.add(missing)
      const sessions = yield* SessionV2.Service

      const result = yield* Effect.exit(sessions.revert.commit(missing))
      expect(hasFailure(result, new SessionV2.NotFoundError({ sessionID: missing }))).toBe(true)
      active.delete(missing)
    }),
  )

  it.effect("wait and interrupt are no-ops or joins, never failures, for known Sessions", () =>
    Effect.gen(function* () {
      yield* createSession
      const sessions = yield* SessionV2.Service

      yield* sessions.interrupt(sessionID)
      active.add(sessionID)
      yield* sessions.interrupt(sessionID)
      active.delete(sessionID)

      const wait = yield* Effect.exit(sessions.wait(sessionID))
      expect(hasFailure(wait, new SessionV2.OperationUnavailableError({ operation: "wait" }))).toBe(true)
    }),
  )
})
