import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { AgentV2 } from "@prioricode/core/agent"
import { BackgroundJob } from "@prioricode/core/background-job"
import { SessionSchema } from "@prioricode/core/session/schema"
import { Database } from "@prioricode/core/database/database"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { EventV2 } from "@prioricode/core/event"
import { AbsolutePath } from "@prioricode/core/schema"
import { Location } from "@prioricode/core/location"
import { PermissionV2 } from "@prioricode/core/permission"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { SessionV2 } from "@prioricode/core/session"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionInput } from "@prioricode/core/session/input"
import { SessionProjector } from "@prioricode/core/session/projector"
import { SessionStore } from "@prioricode/core/session/store"
import { SessionTable } from "@prioricode/core/session/sql"
import { TaskTool } from "@prioricode/core/tool/task"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool } from "./lib/tool"

const parentSessionID = SessionV2.ID.make("ses_task_parent")

const resumed: SessionV2.ID[] = []
const interrupted: SessionV2.ID[] = []
const startedJobs: string[] = []

const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set<SessionV2.ID>()),
    resume: (sessionID) =>
      Effect.sync(() => {
        resumed.push(sessionID)
      }),
    wake: (sessionID) =>
      Effect.sync(() => {
        resumed.push(sessionID)
      }),
    interrupt: (sessionID) =>
      Effect.sync(() => {
        interrupted.push(sessionID)
      }),
  }),
)

const general: AgentV2.Info = {
  id: AgentV2.ID.make("general"),
  mode: "subagent",
  hidden: false,
  permissions: [],
  request: { headers: {}, body: {} },
}

const agents = Layer.succeed(
  AgentV2.Service,
  AgentV2.Service.of({
    transform: () => Effect.succeed({ dispose: Effect.void, remove: () => Effect.void }),
    reload: () => Effect.void,
    get: (id) => Effect.succeed(id === "general" ? general : undefined),
    default: () => Effect.succeed(general),
    resolve: (id) => Effect.succeed(id === undefined || id === "general" ? general : undefined),
    select: () => Effect.succeed({ id: AgentV2.ID.make("build"), info: undefined }),
    all: () => Effect.succeed([general]),
  }),
)

const background = Layer.succeed(
  BackgroundJob.Service,
  BackgroundJob.Service.of({
    list: () => Effect.succeed([]),
    get: () => Effect.succeed(undefined),
    start: (input) =>
      Effect.sync(() => {
        startedJobs.push(input.id ?? "job")
      }).pipe(
        Effect.as({
          id: input.id ?? "job",
          type: input.type,
          status: "running" as const,
          started_at: 0,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        }),
      ),
    extend: () => Effect.succeed(false),
    wait: () => Effect.succeed({ timedOut: false }),
    waitForPromotion: () => Effect.runPromise(Effect.never) as never,
    promote: () => Effect.succeed(undefined),
    cancel: () => Effect.succeed(undefined),
  }),
)

const reset = () => {
  resumed.length = 0
  interrupted.length = 0
  startedJobs.length = 0
}

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

const activeLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)

const withTask = <A, E, R>(body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([
          Database.node,
          EventV2.node,
          SessionProjector.node,
          SessionStore.node,
          SessionV2.node,
          ToolRegistry.node,
          ToolRegistry.toolsNode,
          TaskTool.node,
        ]),
        [
          [SessionExecution.node, execution],
          [AgentV2.node, agents],
          [BackgroundJob.node, background],
          [PermissionV2.node, permission],
          [Location.node, activeLocation],
        ],
      ),
    ),
  )

const insertSession = (id: SessionV2.ID, parentID?: SessionV2.ID) =>
  Effect.gen(function* () {
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
        id: SessionSchema.ID.make(id),
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: "task host",
        version: "test",
        ...(parentID === undefined ? {} : { parent_id: parentID }),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const call = (input: typeof TaskTool.Input.Type, sessionID = parentSessionID, id = "call-task") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "task" as const, input },
})

const taskText = (result: { type: string; value: unknown }) => {
  if (result.type === "error") throw new Error(String(result.value))
  const text = String(result.value)
  const match = /<task id="([^"]+)" state="([^"]+)"/.exec(text)
  expect(match).not.toBeNull()
  return { sessionID: match![1], state: match![2], text }
}

const it = testEffect(Layer.empty)

describe("TaskTool", () => {
  it.effect("creates a child Session, admits the prompt as queue work, and settles foreground", () =>
    withTask((registry) =>
      Effect.gen(function* () {
        yield* insertSession(parentSessionID)
        const output = taskText(
          yield* executeTool(
            registry,
            call({ description: "Research auth", prompt: "Map the auth flow and report the files involved." }),
          ),
        )
        expect(output.sessionID).toStartWith("ses_")
        expect(output.text).toContain('state="error"')
        expect(resumed).toEqual([output.sessionID as SessionV2.ID])

        const { db } = yield* Database.Service
        const child = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, SessionSchema.ID.make(output.sessionID)))
          .get()
          .pipe(Effect.orDie)
        expect(child?.parent_id).toBe(parentSessionID)
        expect(child?.agent).toBe("general")
        expect(child?.title).toBe("Research auth (@general subagent)")
        expect(yield* SessionInput.hasPending(db, output.sessionID as SessionV2.ID, "queue")).toBe(true)
      }),
    ),
  )

  it.effect("continues an existing child Session with task_id", () =>
    withTask((registry) =>
      Effect.gen(function* () {
        reset()
        const childID = SessionV2.ID.make("ses_task_existing_child")
        yield* insertSession(parentSessionID)
        yield* insertSession(childID, parentSessionID)
        const result = yield* executeTool(
          registry,
          call({ description: "Continue", prompt: "Now verify the tests.", task_id: childID }),
        )
        expect(taskText(result).sessionID).toBe(childID)
        expect(resumed).toEqual([childID])
      }),
    ),
  )

  it.effect("refuses a task_id not owned by the caller", () =>
    withTask((registry) =>
      Effect.gen(function* () {
        reset()
        const strangerID = SessionV2.ID.make("ses_task_stranger")
        yield* insertSession(parentSessionID)
        yield* insertSession(strangerID)
        const result = yield* executeTool(registry, call({ description: "Hijack", prompt: "x", task_id: strangerID }))
        expect(result).toEqual({ type: "error", value: expect.stringContaining("not owned") })
      }),
    ),
  )

  it.effect("rejects nested subagents and unknown subagent types", () =>
    withTask((registry) =>
      Effect.gen(function* () {
        reset()
        const childID = SessionV2.ID.make("ses_task_nested")
        yield* insertSession(parentSessionID)
        yield* insertSession(childID, parentSessionID)
        const nested = yield* executeTool(registry, call({ description: "Nested", prompt: "go" }, childID))
        expect(nested).toEqual({ type: "error", value: expect.stringContaining("cannot launch") })
        const unknown = yield* executeTool(
          registry,
          call({ description: "Bad type", prompt: "x", subagent_type: "nope" }, parentSessionID),
        )
        expect(unknown).toEqual({ type: "error", value: expect.stringContaining("Unknown subagent type nope") })
      }),
    ),
  )

  it.effect("launches background children as jobs and returns immediately", () =>
    withTask((registry) =>
      Effect.gen(function* () {
        reset()
        yield* insertSession(parentSessionID)
        const result = yield* executeTool(
          registry,
          call({ description: "Audit deps", prompt: "List unused dependencies.", background: true }),
        )
        const output = taskText(result)
        expect(output.state).toBe("running")
        expect(output.text).toContain("working in the background")
        expect(startedJobs).toEqual([output.sessionID])
        expect(resumed).toEqual([])
      }),
    ),
  )
})
