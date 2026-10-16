import { describe, expect } from "bun:test"
import { SessionV1 } from "@prioricode/core/v1/session"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { SessionProjector } from "@prioricode/core/session/projector"
import { Database } from "@prioricode/core/database/database"
import { CrossSpawnSpawner } from "@prioricode/core/cross-spawn-spawner"
import { Provider } from "@prioricode/core/provider"
import { Model } from "@prioricode/core/model"
import { EventBridge } from "@/event-v2-bridge"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { Session } from "@/session/session"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Session.node,
      SessionSummary.node,
      Snapshot.node,
      SessionProjector.node,
      Database.node,
      EventBridge.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)

const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const userMessage = Effect.fn("test.user")(function* (sessionID: SessionID) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "default",
    model: { providerID: Provider.ID.make("openai"), modelID: Model.ID.make("gpt-4") },
    time: { created: Date.now() },
  })
})

const assistantMessage = Effect.fn("test.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  dir: string,
) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "default",
    agent: "default",
    path: { cwd: dir, root: dir },
    cost: 0,
    tokens,
    modelID: Model.ID.make("gpt-4"),
    providerID: Provider.ID.make("openai"),
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  })
})

const stepStart = Effect.fn("test.stepStart")(function* (
  sessionID: SessionID,
  messageID: MessageID,
  snapshot: string | undefined,
) {
  const session = yield* Session.Service
  return yield* session.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "step-start",
    snapshot,
  })
})

const stepFinish = Effect.fn("test.stepFinish")(function* (
  sessionID: SessionID,
  messageID: MessageID,
  snapshot: string | undefined,
) {
  const session = yield* Session.Service
  return yield* session.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "step-finish",
    reason: "end_turn",
    snapshot,
    cost: 0,
    tokens,
  })
})

describe("SessionSummary", () => {
  it.live(
    "skips re-emitting message.updated while the snapshot range is unchanged",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const summary = yield* SessionSummary.Service
          const snapshot = yield* Snapshot.Service
          const events = yield* EventBridge.Service

          const info = yield* session.create({})
          const sid = info.id
          const user = yield* userMessage(sid)
          const assistant = yield* assistantMessage(sid, user.id, dir)

          const hash = yield* snapshot.track()
          yield* stepStart(sid, assistant.id, hash)
          yield* stepFinish(sid, assistant.id, hash)

          let emitted = 0
          const off = yield* events.listen((evt) => {
            if (evt.type !== SessionV1.Event.MessageUpdated.type) return Effect.void
            if ((evt.data as { info?: { id?: string } }).info?.id === user.id) emitted++
            return Effect.void
          })
          yield* Effect.addFinalizer(() => off)

          yield* summary.summarize({ sessionID: sid, messageID: user.id })
          expect(emitted).toBe(1)

          yield* summary.summarize({ sessionID: sid, messageID: user.id })
          expect(emitted).toBe(1)

          yield* Effect.promise(() => fs.writeFile(path.join(dir, "a.txt"), "hello\n"))
          const next = yield* snapshot.track()
          expect(next).not.toBe(hash)
          yield* stepFinish(sid, assistant.id, next)

          yield* summary.summarize({ sessionID: sid, messageID: user.id })
          expect(emitted).toBe(2)

          const stored = yield* session.messages({ sessionID: sid })
          const storedSummary = stored.find((m) => m.info.id === user.id)?.info.summary
          const diffs = typeof storedSummary === "object" && storedSummary !== null ? storedSummary.diffs : undefined
          expect(diffs?.some((d: { file?: string }) => d.file === "a.txt")).toBe(true)

          yield* session.remove(sid)
        }),
      { git: true },
    ),
  )

  it.live(
    "caps oversized patches but keeps counts and small patches",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const summary = yield* SessionSummary.Service
          const snapshot = yield* Snapshot.Service

          const big = Array.from({ length: 30_000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n")
          yield* Effect.promise(() => fs.writeFile(path.join(dir, "big.txt"), big))
          yield* Effect.promise(() => fs.writeFile(path.join(dir, "small.txt"), "one\ntwo\n"))
          const from = yield* snapshot.track()

          yield* Effect.promise(() =>
            fs.writeFile(path.join(dir, "big.txt"), big.replace("line 15000 ", "line 15000 CHANGED ")),
          )
          yield* Effect.promise(() => fs.writeFile(path.join(dir, "small.txt"), "one\nTWO\nthree\n"))
          const to = yield* snapshot.track()

          const user = {
            id: MessageID.ascending(),
            sessionID: SessionID.make("ses_test_summary_cap"),
            role: "user" as const,
            agent: "default",
            model: { providerID: Provider.ID.make("openai"), modelID: Model.ID.make("gpt-4") },
            time: { created: Date.now() },
          } as unknown as SessionV1.Info
          const messages: SessionV1.WithParts[] = [
            {
              info: user,
              parts: [
                {
                  id: PartID.ascending(),
                  messageID: user.id,
                  sessionID: user.sessionID,
                  type: "step-start",
                  snapshot: from,
                },
                {
                  id: PartID.ascending(),
                  messageID: user.id,
                  sessionID: user.sessionID,
                  type: "step-finish",
                  reason: "end_turn",
                  snapshot: to,
                  cost: 0,
                  tokens,
                },
              ],
            },
          ]

          const diffs = yield* summary.computeDiff({ messages })
          const bigDiff = diffs.find((d) => d.file === "big.txt")
          const smallDiff = diffs.find((d) => d.file === "small.txt")

          expect(bigDiff?.patch).toBe("")
          expect(bigDiff?.additions).toBe(1)
          expect(bigDiff?.deletions).toBe(1)
          expect((smallDiff?.patch ?? "").length).toBeGreaterThan(0)

          yield* Effect.void
        }),
      { git: true },
    ),
  )
})
