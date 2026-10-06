import { describe, expect } from "bun:test"
import { LLMEvent, type LLMRequest } from "@prioricode/llm"
import { Database } from "@prioricode/core/database/database"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { EventV2 } from "@prioricode/core/event"
import { CommandBuiltIns } from "@prioricode/core/command/builtins"
import { CommandV2 } from "@prioricode/core/command"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionV2 } from "@prioricode/core/session"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionInput } from "@prioricode/core/session/input"
import { SessionProjector } from "@prioricode/core/session/projector"
import { SessionStore } from "@prioricode/core/session/store"
import { SessionReviewGate } from "@prioricode/core/session/runner/review-gate"
import { SessionRunnerModel } from "@prioricode/core/session/runner/model"
import { Model } from "@prioricode/llm"
import * as OpenAIChat from "@prioricode/llm/protocols/openai-chat"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { SessionInputTable } from "@prioricode/core/session/sql"
import { Effect, Layer, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const directory = "/review-project"
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })

const judgeTexts: string[] = []
let judgeScript: string[] = []
let judgeFails = false

const judge = (request: LLMRequest): Stream.Stream<LLMEvent, unknown> => {
  judgeTexts.push(request.messages.map((message) => JSON.stringify(message)).join("|"))
  if (judgeFails) return Stream.fail(new Error("reviewer down"))
  const next = judgeScript.shift()
  if (next === undefined) return Stream.empty
  return Stream.fromIterable([
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.textStart({ id: "review-1" }),
    LLMEvent.textDelta({ id: "review-1", text: next }),
    LLMEvent.textEnd({ id: "review-1" }),
    LLMEvent.stepFinish({ index: 0, reason: "stop" }),
    LLMEvent.finish({ reason: "stop" }),
  ])
}

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      CommandV2.node,
      CommandBuiltIns.node,
    ]),
    [
      [SessionExecution.node, SessionExecution.noopLayer],
      [
        Project.node,
        Layer.succeed(
          Project.Service,
          Project.Service.of({
            resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory }),
            directories: () => Effect.succeed([]),
            commit: () => Effect.void,
          }),
        ),
      ],
    ],
  ),
)

const gateFor = Effect.fn("test.reviewGateFor")(function* (enabled: boolean, goal: string) {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  const store = yield* SessionStore.Service
  const sessions = yield* SessionV2.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
  if (goal !== "") yield* sessions.setGoal({ sessionID: created.id, goal })
  const gate = SessionReviewGate.asGate({
    db,
    events,
    store,
    judge,
    models: { resolve: () => Effect.succeed(model) },
    sessionID: created.id,
    enabled,
  })
  return { gate, sessionID: created.id, db }
})

const steerTexts = (db: Database.Interface["db"], sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(SessionInputTable)
      .where(eq(SessionInputTable.session_id, sessionID))
      .orderBy(asc(SessionInputTable.admitted_seq))
      .all()
      .pipe(Effect.orDie)
    return rows.map((row) => row.prompt.text)
  })

describe("review gate", () => {
  it.effect("disabled by default costs nothing", () =>
    Effect.gen(function* () {
      judgeTexts.length = 0
      const { gate } = yield* gateFor(false, "Ship it")
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" })
      expect(judgeTexts).toHaveLength(0)
    }),
  )

  it.effect("a refutation admits exactly one steer and never repeats", () =>
    Effect.gen(function* () {
      judgeScript = ["REFUTED\nthe test command still fails on the edited module"]
      judgeTexts.length = 0
      const { gate, sessionID, db } = yield* gateFor(true, "Ship it")
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Continued" })
      const texts = yield* steerTexts(db, sessionID)
      expect(texts.join("\n")).toContain("test command still fails")
      expect(yield* SessionInput.hasPending(db, sessionID, "steer")).toBe(true)
      // single round: a second finish is silent and buys no extra review
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" })
      expect(judgeTexts).toHaveLength(1)
    }),
  )

  it.effect("sustained, unparsable, and failed reviews all pass through", () =>
    Effect.gen(function* () {
      judgeScript = ["SUSTAINED"]
      const sustained = yield* gateFor(true, "Ship it")
      expect(yield* sustained.gate.beforeFinish()).toEqual({ _tag: "Pass" })
      expect(yield* SessionInput.hasPending(sustained.db, sustained.sessionID, "steer")).toBe(false)

      judgeScript = ["maybe refuted?"]
      const unclear = yield* gateFor(true, "Ship it")
      expect(yield* unclear.gate.beforeFinish()).toEqual({ _tag: "Pass" })

      judgeFails = true
      const broken = yield* gateFor(true, "Ship it")
      expect(yield* broken.gate.beforeFinish()).toEqual({ _tag: "Pass" })
      judgeFails = false
    }),
  )

  it.effect("the reviewer sees the durable goal", () =>
    Effect.gen(function* () {
      judgeScript = ["SUSTAINED"]
      judgeTexts.length = 0
      const { gate } = yield* gateFor(true, "Ship the HTTP surface with README")
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" })
      expect(judgeTexts[0]).toContain("Ship the HTTP surface with README")
      expect(judgeTexts[0]).toContain("adversarial reviewer")
    }),
  )
})

describe("spec command", () => {
  it.effect("/spec is registered with the interview-to-goal template", () =>
    Effect.gen(function* () {
      const commands = yield* CommandV2.Service
      const spec = yield* commands.get("spec")
      expect(spec).toBeDefined()
      expect(spec?.description).toContain("SPEC.md")
      expect(spec?.template).toContain("question tool")
      expect(spec?.template).toContain('goal tool with action "set"')
      const names = (yield* commands.list()).map((command) => command.name)
      expect(names).toContain("spec")
    }),
  )
})
