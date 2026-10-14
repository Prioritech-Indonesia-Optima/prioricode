import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@prioricode/core/agent"
import { Database } from "@prioricode/core/database/database"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { EventBus } from "@prioricode/core/event"
import { AbsolutePath } from "@prioricode/core/schema"
import { Location } from "@prioricode/core/location"
import { Permission } from "@prioricode/core/permission"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { Question } from "@prioricode/core/question"
import { eq } from "drizzle-orm"
import { SessionInputTable } from "@prioricode/core/session/sql"
import { SessionSchema } from "@prioricode/core/session/schema"
import { Session } from "@prioricode/core/session"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionProjector } from "@prioricode/core/session/projector"
import { SessionStore } from "@prioricode/core/session/store"
import { SessionTable } from "@prioricode/core/session/sql"
import { PlanTool } from "@prioricode/core/tool/plan"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool } from "./lib/tool"

const sessionID = Session.ID.make("ses_plan_host")

let answers: string[][] = [["Yes"]]
let reject = false
const asked: Question.AskInput[] = []

const question = Layer.succeed(
  Question.Service,
  Question.Service.of({
    ask: (input) =>
      Effect.sync(() => {
        asked.push(input)
      }).pipe(Effect.andThen(reject ? Effect.fail(new Question.RejectedError()) : Effect.succeed(answers))),
    reply: () => Effect.die("unused"),
    reject: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const permission = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const wake: Session.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set<Session.ID>()),
    resume: (id) =>
      Effect.sync(() => {
        wake.push(id)
      }),
    compact: () => Effect.succeed(false),
    wake: (id) =>
      Effect.sync(() => {
        wake.push(id)
      }),
    interrupt: () => Effect.void,
  }),
)

const asAgent = (agent: Agent.ID | undefined) => agent

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventBus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      PlanTool.node,
    ]),
    [
      [Question.node, question],
      [Permission.node, permission],
      [SessionExecution.node, execution],
      [
        Location.node,
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") }))),
      ],
    ],
  ),
)

const seedSession = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: SessionSchema.ID.make(sessionID),
      project_id: Project.ID.global,
      slug: sessionID,
      directory: "/project",
      title: "plan host",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const call = (name: "plan_enter" | "plan_exit", id = `call-${name}`) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input: {} },
})

const planText = (result: { type: string; value: unknown }) => {
  if (result.type === "error") throw new Error(String(result.value))
  return String(result.value)
}

const pendingSteers = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(eq(SessionInputTable.session_id, SessionSchema.ID.make(sessionID)))
    .all()
    .pipe(Effect.orDie)
  return rows.map((row) => ({ text: row.prompt.text as string, delivery: row.delivery as string }))
})

describe("PlanTool", () => {
  it.effect("plan_enter approval switches the agent and admits a steer without waking the coordinator", () =>
    Effect.gen(function* () {
      asked.length = 0
      wake.length = 0
      answers = [["Yes"]]
      reject = false
      yield* seedSession
      const registry = yield* ToolRegistry.Service
      const session = yield* Session.Service

      const text = planText(yield* executeTool(registry, call("plan_enter")))
      expect(text).toContain("approved switching to plan agent")
      expect(asked[0]?.questions[0]?.header).toBe("Plan Agent")
      expect(asAgent(yield* session.get(sessionID).pipe(Effect.map((info) => info.agent)))).toBe(<Agent.ID>"plan")
      expect(yield* pendingSteers).toEqual([
        { text: expect.stringContaining("Switched to plan agent"), delivery: "steer" },
      ])
      expect(wake).toEqual([])
    }),
  )

  it.effect("plan_exit approval switches to build; declining keeps the current agent", () =>
    Effect.gen(function* () {
      asked.length = 0
      answers = [["Yes"]]
      yield* seedSession
      const registry = yield* ToolRegistry.Service
      const session = yield* Session.Service

      expect(planText(yield* executeTool(registry, call("plan_exit")))).toContain("approved switching to build agent")
      expect(asked[0]?.questions[0]?.header).toBe("Build Agent")
      expect(asAgent(yield* session.get(sessionID).pipe(Effect.map((info) => info.agent)))).toBe(<Agent.ID>"build")

      answers = [["No"]]
      const declined = planText(yield* executeTool(registry, call("plan_enter", "call-enter-declined")))
      expect(declined).toContain("stay with the current agent")
      expect(asAgent(yield* session.get(sessionID).pipe(Effect.map((info) => info.agent)))).toBe(<Agent.ID>"build")
      expect(asked).toHaveLength(2)
    }),
  )

  it.effect("a rejected question settles as a readable tool failure", () =>
    Effect.gen(function* () {
      answers = [["Yes"]]
      reject = true
      yield* seedSession
      const registry = yield* ToolRegistry.Service

      const result = yield* executeTool(registry, call("plan_enter", "call-enter-rejected"))
      expect(result.type).toBe("error")
      if (result.type === "error") expect(result.value).toContain("rejected the plan-mode transition")
    }),
  )
})
