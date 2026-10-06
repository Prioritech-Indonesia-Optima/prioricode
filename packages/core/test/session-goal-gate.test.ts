import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { LLMEvent, Model, type LLMRequest } from "@prioricode/llm"
import * as OpenAIChat from "@prioricode/llm/protocols/openai-chat"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { AppProcess } from "@prioricode/core/process"
import { ConfigGoal } from "@prioricode/core/config/goal"
import { Database } from "@prioricode/core/database/database"
import { EventV2 } from "@prioricode/core/event"
import { AbsolutePath } from "@prioricode/core/schema"
import { ProjectV2 } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { SessionInputTable } from "@prioricode/core/session/sql"
import { asc, eq } from "drizzle-orm"
import { SessionV2 } from "@prioricode/core/session"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionInput } from "@prioricode/core/session/input"
import { SessionProjector } from "@prioricode/core/session/projector"
import { SessionStore } from "@prioricode/core/session/store"
import { SessionGoalGate } from "@prioricode/core/session/runner/goal-gate"
import { testEffect } from "./lib/effect"

const directories: string[] = []
const makeDirectory = async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "prioricode-goal-gate-")))
  directories.push(dir)
  return dir
}

const model = Model.make({ id: "judge", provider: "fake", route: OpenAIChat.route })
const judgeTexts: string[] = []
let judgeScript: string[] = []
let judgeFails = false

const judge = (request: LLMRequest): Stream.Stream<LLMEvent, unknown> => {
  judgeTexts.push(request.messages.map((message) => JSON.stringify(message)).join("|"))
  if (judgeFails) return Stream.fail(new Error("judge unavailable"))
  const next = judgeScript.shift()
  if (next === undefined) return Stream.empty
  return Stream.fromIterable([
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.textStart({ id: "judge-1" }),
    LLMEvent.textDelta({ id: "judge-1", text: next }),
    LLMEvent.textEnd({ id: "judge-1" }),
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
      AppProcess.node,
    ]),
    [
      [SessionExecution.node, SessionExecution.noopLayer],
      [
        ProjectV2.node,
        Layer.succeed(
          ProjectV2.Service,
          ProjectV2.Service.of({
            resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
            directories: () => Effect.succeed([]),
            commit: () => Effect.void,
          }),
        ),
      ],
    ],
  ),
)

const gateFor = Effect.fn("test.gateFor")(function* (
  directory: string,
  config: ConfigGoal.Info | undefined,
  goal: string,
) {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  const store = yield* SessionStore.Service
  const appProcess = yield* AppProcess.Service
  const sessions = yield* SessionV2.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
  yield* sessions.setGoal({ sessionID: created.id, goal })
  const gate = SessionGoalGate.asGate({
    db,
    events,
    store,
    process: appProcess,
    judge,
    models: { resolve: () => Effect.succeed(model) },
    directory,
    sessionID: created.id,
    config,
  })
  return { gate, sessionID: created.id, db, sessions }
})

const info = (input: Partial<ConstructorParameters<typeof ConfigGoal.Info>[0]>) => new ConfigGoal.Info(input)

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

describe("goal gate", () => {
  afterAll(async () => {
    for (const dir of directories) await fs.rm(dir, { recursive: true, force: true })
  })

  it.live("command success clears the goal and admits nothing", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory())
      const { gate, sessionID, db, sessions } = yield* gateFor(
        dir,
        info({ check: "command", command: "exit 0" }),
        "Ship it",
      )
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" })
      expect((yield* sessions.get(sessionID)).goal).toBeUndefined()
      expect(yield* SessionInput.hasPending(db, sessionID, "steer")).toBe(false)
    }),
  )

  it.live("command failure continues once with the output, then fails open at the cap", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory())
      const { gate, sessionID, db, sessions } = yield* gateFor(
        dir,
        info({ check: "command", command: "printf 'tests still red\\n'; exit 1", max_attempts: 1 }),
        "Ship it",
      )
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Continued" })
      expect(yield* SessionInput.hasPending(db, sessionID, "steer")).toBe(true)
      const prompts = yield* steerTexts(db, sessionID)
      expect(prompts.join("\n")).toContain("tests still red")
      expect((yield* sessions.get(sessionID)).goal).toBe("Ship it")
      // a second finish is silent: attempts reached max_attempts
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" })
    }),
  )

  it.effect("no goal: pass with zero cost", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory())
      const { gate } = yield* gateFor(dir, info({ check: "command", command: "exit 1" }), "")
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" })
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" })
    }),
  )

  it.effect("check off never evaluates", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory())
      const { gate, sessionID, db } = yield* gateFor(dir, info({ check: "off" }), "Ship it")
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" })
      expect(yield* SessionInput.hasPending(db, sessionID, "steer")).toBe(false)
    }),
  )

  it.effect("llm DONE clears the goal", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory())
      judgeScript = ["DONE."]
      judgeTexts.length = 0
      const { gate, sessions, sessionID } = yield* gateFor(dir, info({ check: "llm" }), "Ship it")
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" })
      expect((yield* sessions.get(sessionID)).goal).toBeUndefined()
    }),
  )

  it.effect("llm NOT_DONE continues with the reason and the judge saw the goal", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory())
      judgeScript = ["NOT_DONE\nthe README is still missing"]
      judgeTexts.length = 0
      const { gate, sessionID, db } = yield* gateFor(dir, info({ check: "llm" }), "Ship it with README")
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Continued" })
      expect(yield* SessionInput.hasPending(db, sessionID, "steer")).toBe(true)
      const prompts = yield* steerTexts(db, sessionID)
      expect(prompts.join("\n")).toContain("the README is still missing")
      expect(judgeTexts[0]).toContain("Ship it with README")
    }),
  )

  it.effect("llm verdict is reused while no tool runs, and re-evaluated after one", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory())
      judgeScript = ["NOT_DONE\nnot built", "DONE"]
      judgeTexts.length = 0
      const { gate } = yield* gateFor(dir, info({ check: "llm", max_attempts: 5 }), "Ship it")
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Continued" })
      // no mutation since verdict: reused without a new judge call
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Continued" })
      expect(judgeTexts).toHaveLength(1)
      gate.observe("edit", true)
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" }) // DONE now
      expect(judgeTexts).toHaveLength(2)
    }),
  )

  it.effect("llm unparsable output and judge failures fail open", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory())
      judgeScript = ["maybe?"]
      const { gate, sessions, sessionID } = yield* gateFor(dir, info({ check: "llm" }), "Ship it")
      expect(yield* gate.beforeFinish()).toEqual({ _tag: "Pass" })
      expect((yield* sessions.get(sessionID)).goal).toBe("Ship it")
      judgeFails = true
      judgeScript = ["DONE"]
      const failing = yield* gateFor(dir, info({ check: "llm" }), "Ship it")
      expect(yield* failing.gate.beforeFinish()).toEqual({ _tag: "Pass" })
      judgeFails = false
    }),
  )
})
