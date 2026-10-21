import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@prioricode/core/database/database"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { EventBus } from "@prioricode/core/event"
import { Permission } from "@prioricode/core/permission"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { Session } from "@prioricode/core/session"
import { SessionTable } from "@prioricode/core/session/sql"
import { SessionTodo } from "@prioricode/core/session/todo"
import { TodoWriteTool } from "@prioricode/core/tool/todowrite"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { ToolOutputStore } from "@prioricode/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = Session.ID.make("ses_todowrite_tool_test")
const assertions: Permission.AssertInput[] = []
let deny = false

const permission = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new Permission.BlockedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventBus.node,
      SessionTodo.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      TodoWriteTool.node,
    ]),
    [
      [Permission.node, permission],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

const setup = Effect.gen(function* () {
  assertions.length = 0
  deny = false
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "todowrite",
      directory: "/project",
      title: "todowrite",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const call = (input: Record<string, unknown>, id = "call-todowrite") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: TodoWriteTool.name, input },
})

const withoutIds = (todos: ReadonlyArray<SessionTodo.Info>) =>
  todos.map((todo) => {
    const { id: _id, ...rest } = todo
    return rest
  })

// Result values are strings; extract once because matcher objects must not be re-asserted.
const resultText = (result: { type: string; value: unknown }) => String(result.value)
const structured = (output: unknown) =>
  (output as { structured: { todos: SessionTodo.Info[]; text: string } }).structured

const seed = (registry: ToolRegistry.Interface, list: ReadonlyArray<SessionTodo.Info>) =>
  settleTool(registry, call({ todos: list })).pipe(
    Effect.flatMap((settled) =>
      settled.result.type === "error" ? Effect.die(settled.result.value) : Effect.succeed(settled),
    ),
  )

describe("TodoWriteTool", () => {
  it.effect("seeds via a bare todos array, returns an id-bearing checklist, and persists", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const todoList: ReadonlyArray<SessionTodo.Info> = [
        { content: "Implement slice", status: "in_progress", priority: "high" },
      ]

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([TodoWriteTool.name])
      const settled = yield* seed(registry, todoList)
      const text = resultText(settled.result)
      expect(text).toContain("[>]")
      expect(text).toContain("Implement slice")
      const todos = structured(settled.output).todos
      expect(withoutIds(todos)).toEqual([...todoList])
      expect(text).toContain(`(${todos[0]!.id})`)
      expect(todos[0]!.id).toMatch(/^td_[0-9a-f]{8}$/)
      expect(assertions.length).toBe(1)
      expect(assertions[0]!.action).toBe("todowrite")
      expect(assertions[0]!.resources).toEqual(["*"])
      expect(assertions[0]!.save).toEqual(["*"])
      expect(assertions[0]!.sessionID).toBe(sessionID)
      expect(yield* service.get(sessionID)).toEqual(todos.map((todo) => ({ ...todo, depth: 0 })))
    }),
  )

  it.effect("view reads the live list without touching permissions or storage", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      yield* service.update({ sessionID, todos: [{ content: "keep", status: "pending", priority: "low" }] })
      assertions.length = 0

      const result = yield* executeTool(registry, call({ action: "view" }))
      expect(result.type).toBe("text")
      const text = resultText(result)
      expect(text).toContain("[ ]")
      expect(text).toContain("keep")
      expect(text).toMatch(/td_[0-9a-f]{8}/)
      expect(assertions.length).toBe(0)
    }),
  )

  it.effect("status completes the current task and starts the next in one batched call", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const settled = yield* seed(registry, [
        { content: "first", status: "in_progress", priority: "high" },
        { content: "second", status: "pending", priority: "medium" },
      ])
      const [first, second] = structured(settled.output).todos
      assertions.length = 0

      const result = yield* executeTool(
        registry,
        call({
          action: "status",
          status: [
            { id: first!.id, status: "completed" },
            { id: second!.id, status: "in_progress" },
          ],
        }),
      )
      expect(result.type).toBe("text")
      expect(resultText(result)).toContain("Updated 2 item(s)")
      const stored = yield* service.get(sessionID)
      expect(stored.map((todo) => todo.status)).toEqual(["completed", "in_progress"])
      expect(stored.map((todo) => todo.id)).toEqual([first!.id, second!.id])
      expect(assertions.length).toBe(1)
    }),
  )

  it.effect("status rejects unknown ids and re-grounds with the live list", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const settled = yield* seed(registry, [{ content: "real", status: "pending", priority: "low" }])
      const live = structured(settled.output).todos[0]!.id!
      assertions.length = 0

      const result = yield* executeTool(
        registry,
        call({ action: "status", status: [{ id: "td_00000000", status: "completed" }] }),
      )
      expect(result.type).toBe("error")
      const text = resultText(result)
      expect(text).toContain("Unknown todo id")
      expect(text).toContain(live)
      expect(text).toContain("real")
      expect(assertions.length).toBe(0)
    }),
  )

  it.effect("replace guards unfinished items until the exact confirm set is echoed", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const settled = yield* seed(registry, [
        { content: "carry on", status: "in_progress", priority: "high" },
        { content: "later", status: "pending", priority: "low" },
      ])
      const before = structured(settled.output).todos
      assertions.length = 0

      const blocked = yield* executeTool(
        registry,
        call({ action: "replace", todos: [{ content: "pivot", status: "in_progress", priority: "high" }] }),
      )
      expect(blocked.type).toBe("error")
      expect(resultText(blocked)).toContain("unfinished task(s)")
      expect(resultText(blocked)).toContain(before[0]!.id!)

      const wrongConfirm = yield* executeTool(
        registry,
        call({
          action: "replace",
          todos: [{ content: "pivot", status: "in_progress", priority: "high" }],
          confirm: [before[0]!.id],
        }),
      )
      expect(wrongConfirm.type).toBe("error")

      const confirmed = yield* executeTool(
        registry,
        call({
          action: "replace",
          todos: [{ content: "pivot", status: "in_progress", priority: "high" }],
          confirm: [before[0]!.id, before[1]!.id],
        }),
      )
      expect(confirmed.type).toBe("text")
      expect(resultText(confirmed)).toContain("Replaced the todo list")
      const after = yield* service.get(sessionID)
      expect(after).toHaveLength(1)
      expect(after[0]!.id).not.toBe(before[0]!.id)
      expect(withoutIds(after)).toEqual([{ content: "pivot", status: "in_progress", priority: "high", depth: 0 }])
    }),
  )

  it.effect("replace on an empty or settled list seeds freely", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      yield* seed(registry, [{ content: "done thing", status: "completed", priority: "low" }])
      assertions.length = 0

      const result = yield* executeTool(
        registry,
        call({ action: "replace", todos: [{ content: "fresh", status: "pending", priority: "low" }] }),
      )
      expect(result.type).toBe("text")
      expect(resultText(result)).toContain("Seeded")
    }),
  )

  it.effect("add inserts after a target id and appends by default", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const settled = yield* seed(registry, [{ content: "anchor", status: "pending", priority: "low" }])
      const anchor = structured(settled.output).todos[0]!.id!

      yield* executeTool(
        registry,
        call({ action: "add", add: [{ content: "inserted", after: anchor }, { content: "tail" }] }),
      )
      const after = yield* service.get(sessionID)
      expect(after.map((todo) => todo.content)).toEqual(["anchor", "inserted", "tail"])
      expect(after[2]!.priority).toBe("medium")
    }),
  )

  it.effect("edit rewords items and clears phases with an empty label", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const settled = yield* seed(registry, [
        { content: "old text", status: "pending", priority: "low", phase: "Phase 1: schema" },
      ])
      const target = structured(settled.output).todos[0]!.id!

      yield* executeTool(registry, call({ action: "edit", edit: [{ id: target, content: "new text", phase: "" }] }))
      const after = yield* service.get(sessionID)
      expect(after[0]!.content).toBe("new text")
      expect(after[0]!.phase).toBeUndefined()
      expect(after[0]!.id).toBe(target)
    }),
  )

  it.effect("remove rejects a final list that violates the invariants", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const settled = yield* seed(registry, [
        { content: "done", status: "completed", priority: "low" },
        { content: "active", status: "in_progress", priority: "high" },
        { content: "next", status: "pending", priority: "medium" },
      ])
      const active = structured(settled.output).todos[1]!.id!

      const result = yield* executeTool(registry, call({ action: "remove", remove: [active] }))
      expect(result.type).toBe("error")
      expect(resultText(result)).toContain("invalid")
      expect((yield* service.get(sessionID)).map((todo) => todo.content)).toEqual(["done", "active", "next"])
    }),
  )

  it.effect("warns when a phase label appears in separate blocks", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const result = yield* executeTool(
        registry,
        call({
          todos: [
            { content: "a", status: "pending", priority: "low", phase: "P1" },
            { content: "b", status: "in_progress", priority: "low", phase: "P2" },
            { content: "c", status: "pending", priority: "low", phase: "P1" },
          ],
        }),
      )
      expect(result.type).toBe("text")
      expect(resultText(result)).toContain('phase "P1" appears in separate blocks')
    }),
  )

  it.effect("rejects malformed lists before permissions or storage are touched", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service

      const result = yield* executeTool(
        registry,
        call({
          todos: [
            { content: "one", status: "in_progress", priority: "high" },
            { content: "two", status: "in_progress", priority: "high" },
          ],
        }),
      )
      expect(result.type).toBe("error")
      expect(resultText(result)).toContain("Only one task")
      expect(assertions.length).toBe(0)
      expect(yield* service.get(sessionID)).toEqual([])
    }),
  )

  it.effect("does not update persisted todos when permission is denied", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      yield* service.update({ sessionID, todos: [{ content: "blocked", status: "pending", priority: "low" }] })
      deny = true

      const result = yield* executeTool(registry, call({ action: "add", add: [{ content: "new item" }] }))
      expect(result.type).toBe("error")
      expect(resultText(result)).toContain("Blocked by permission rules")
      expect((yield* service.get(sessionID)).map((todo) => todo.content)).toEqual(["blocked"])
    }),
  )
})
