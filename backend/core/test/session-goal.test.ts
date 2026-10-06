import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@prioricode/llm"
import * as OpenAIChat from "@prioricode/llm/protocols/openai-chat"
import { AgentV2 } from "@prioricode/core/agent"
import { Config } from "@prioricode/core/config"
import { Database } from "@prioricode/core/database/database"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@prioricode/core/effect/app-node-platform"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { EventV2 } from "@prioricode/core/event"
import { EventTable } from "@prioricode/core/event/sql"
import { Location } from "@prioricode/core/location"
import { PermissionV2 } from "@prioricode/core/permission"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionV2 } from "@prioricode/core/session"
import { SessionGoal } from "@prioricode/core/session/goal"
import { SessionProjector } from "@prioricode/core/session/projector"
import { SessionRunner } from "@prioricode/core/session/runner"
import * as SessionRunnerLLM from "@prioricode/core/session/runner/llm"
import { SessionRunnerModel } from "@prioricode/core/session/runner/model"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionRunCoordinator } from "@prioricode/core/session/run-coordinator"
import { SessionInputTable, SessionMessageTable, SessionTable } from "@prioricode/core/session/sql"
import { SessionStore } from "@prioricode/core/session/store"
import { Prompt } from "@prioricode/core/session/prompt"
import { GoalTool } from "@prioricode/core/tool/goal"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { SkillGuidance } from "@prioricode/core/skill/guidance"
import { ReferenceGuidance } from "@prioricode/core/reference/guidance"
import { SystemContext } from "@prioricode/core/system-context"
import { Snapshot } from "@prioricode/core/snapshot"
import { executeTool, toolIdentity } from "./lib/tool"
import { testEffect } from "./lib/effect"
import { asc, eq } from "drizzle-orm"
import { Effect, Layer, Stream } from "effect"

const directory = "/goal-project"
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })

let responses: LLMEvent[][] = []
const requests: LLMRequest[] = []
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(responses.shift() ?? [])
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const location = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory: AbsolutePath.make(directory),
    workspaceID: undefined,
    project: { id: Project.ID.global, directory: AbsolutePath.make(directory) },
    vcs: undefined,
  }),
)

const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [Location.node, location],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [PermissionV2.node, permission],
  [Config.node, config],
])
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
      compact: () => Effect.succeed(false),
    })
  }),
).pipe(Layer.provide(runnerLayer))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      GoalTool.node,
      SessionRunnerModel.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [SessionRunnerModel.node, models],
      [Location.node, location],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_goal_test")
const otherID = SessionV2.ID.make("ses_goal_other")

const setup = Effect.gen(function* () {
  responses = []
  requests.length = 0
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  for (const id of [sessionID, otherID])
    yield* db
      .insert(SessionTable)
      .values({ id, project_id: Project.ID.global, slug: id, directory, title: "goal test", version: "test" })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
})

const turnRequests = () => requests.filter((request) => !JSON.stringify(request.messages).includes("completion judge"))
const systemTexts = (request: LLMRequest) =>
  ((request as unknown as { readonly system?: ReadonlyArray<{ readonly text?: string }> }).system ?? []).flatMap(
    (part) => (part.text === undefined ? [] : [part.text]),
  )
const goalEventCount = (id: SessionV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, id)).all().pipe(Effect.orDie)
    return rows.filter((row) => row.type.includes("goal")).length
  })

describe("session goal", () => {
  it.live("a goal set before the drain is anchored into the baseline system context", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.setGoal({ sessionID, goal: "Ship phase 4 with green tests" })
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Work" }), resume: false })
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
      ]
      yield* session.resume(sessionID)
      expect(turnRequests()).toHaveLength(1)
      expect(systemTexts(turnRequests()[0]!).join("\n")).toContain("durable goal for this session")
      expect(systemTexts(turnRequests()[0]!).join("\n")).toContain("Ship phase 4 with green tests")
      const context = yield* session.context(sessionID)
      expect(context.some((message) => message.type === "goal-set")).toBe(true)
      expect(JSON.stringify(turnRequests()[0]!.messages)).not.toContain("goal-set")
    }),
  )

  it.live("setGoal with the same value is a no-op; empty value clears", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.setGoal({ sessionID, goal: "Alpha" })
      const info = yield* session.get(sessionID)
      expect(info.goal).toBe("Alpha")
      const before = yield* goalEventCount(sessionID)
      yield* session.setGoal({ sessionID, goal: "Alpha" })
      expect(yield* goalEventCount(sessionID)).toBe(before)
      yield* session.setGoal({ sessionID, goal: "" })
      expect((yield* session.get(sessionID)).goal).toBeUndefined()
    }),
  )

  it.live("the goal tool sets, shows, and clears the durable goal", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const session = yield* SessionV2.Service
      const shown = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-goal-show", name: "goal", input: { action: "show" } },
      })
      expect(shown).toMatchObject({ type: "text", value: "No goal is set for this session." })
      expect(shown).not.toMatchObject({ type: "error" })
      const set = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-goal-set",
          name: "goal",
          input: { action: "set", objective: "Fix the flaky suite", done_when: "bun test is green twice" },
        },
      })
      expect(set).toMatchObject({ type: "text" })
      expect((yield* session.get(sessionID)).goal).toBe("Fix the flaky suite\nDone when: bun test is green twice")
      const cleared = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-goal-clear", name: "goal", input: { action: "clear" } },
      })
      expect(cleared).toMatchObject({ type: "text", value: "Session goal cleared." })
      expect((yield* session.get(sessionID)).goal).toBeUndefined()
    }),
  )

  it.live("a mid-drain goal update reaches the next provider turn as chronological context", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Set a goal" }), resume: false })
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({
            id: "call-goal-mid",
            name: "goal",
            input: { action: "set", objective: "Mid-drain objective" },
          }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
      ]
      yield* session.resume(sessionID)
      expect(turnRequests()).toHaveLength(2)
      expect(JSON.stringify(turnRequests()[1]!.messages)).toContain("Mid-drain objective")
      expect((yield* session.get(sessionID)).goal).toBe("Mid-drain objective")
    }),
  )

  it.effect("GoalSet replays decode and rebuild the durable column and message rows", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      yield* session.setGoal({ sessionID, goal: "Replay me" })
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "ignored" }), resume: false })
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      expect(recorded.filter((event) => event.type.startsWith("session.next.goal.set."))).toHaveLength(1)
      yield* events.remove(sessionID)
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* db.delete(SessionInputTable).where(eq(SessionInputTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* db
        .update(SessionTable)
        .set({ goal: null, title: "goal test" })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      const replayed = yield* events.replayAll(
        recorded.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )
      expect(replayed).toBe(sessionID)
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
      expect(row?.goal).toBe("Replay me")
      const messages = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(JSON.stringify(messages)).toContain("goal-set")
      expect((yield* session.get(sessionID)).goal).toBe("Replay me")
    }),
  )

  it.effect("the goal context factory treats undefined and empty identically", () =>
    Effect.gen(function* () {
      expect(SessionGoal.render("X")).toContain("X")
      expect(SessionGoal.render("X")).toContain("durable goal")
      const combined = SystemContext.combine([SessionGoal.context(undefined), SessionGoal.context("")])
      const withGoal = SystemContext.combine([SessionGoal.context("X")])
      expect(combined).not.toBe(withGoal)
    }),
  )

  it.effect("setGoal on an unknown session fails with NotFound and leaves no event", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const exit = yield* session.setGoal({ sessionID: SessionV2.ID.make("ses_missing"), goal: "x" }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      const found = yield* session.get(sessionID)
      expect(found.goal).toBeUndefined()
    }),
  )
})
