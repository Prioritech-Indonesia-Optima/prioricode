import { describe, expect, test } from "bun:test"
import { asc } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@prioricode/core/database/database"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { EventBus } from "@prioricode/core/event"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { Session } from "@prioricode/core/session"
import { SessionTable, TodoTable } from "@prioricode/core/session/sql"
import { SessionTodo } from "@prioricode/core/session/todo"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventBus.node, SessionTodo.node])))
const sessionID = Session.ID.make("ses_todo_test")

const setup = Effect.gen(function* () {
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
      slug: "todo",
      directory: "/project",
      title: "todo",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const withoutIds = (todos: ReadonlyArray<SessionTodo.Info>) =>
  todos.map((todo) => {
    const { id: _id, ...rest } = todo
    return rest
  })

describe("SessionTodo", () => {
  it.effect("replaces persisted todos in order and publishes updates", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventBus.Service
      const todos = yield* SessionTodo.Service
      const published = new Array<EventBus.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTodo.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* todos.update({
        sessionID,
        todos: [
          { content: "second", status: "pending", priority: "low" },
          { content: "first", status: "in_progress", priority: "high" },
        ],
      })
      const stored = yield* todos.get(sessionID)
      expect(withoutIds(stored)).toEqual([
        { content: "second", status: "pending", priority: "low" },
        { content: "first", status: "in_progress", priority: "high" },
      ])
      expect(stored.every((todo) => /^td_[0-9a-f]{8}$/.test(todo.id!))).toBe(true)
      expect(new Set(stored.map((todo) => todo.id)).size).toBe(2)
      expect(
        (yield* db.select().from(TodoTable).orderBy(asc(TodoTable.position)).all().pipe(Effect.orDie)).map((row) => ({
          content: row.content,
          position: row.position,
        })),
      ).toEqual([
        { content: "second", position: 0 },
        { content: "first", position: 1 },
      ])

      // carried-over ids survive a replacement write; only new items get minted ones
      yield* todos.update({
        sessionID,
        todos: [
          { id: stored[1].id, content: "first", status: "completed", priority: "high" },
          { content: "replacement", status: "completed", priority: "medium" },
        ],
      })
      const after = yield* todos.get(sessionID)
      expect(withoutIds(after)).toEqual([
        { content: "first", status: "completed", priority: "high" },
        { content: "replacement", status: "completed", priority: "medium" },
      ])
      expect(after[0].id).toBe(stored[1].id)
      expect(after[1].id).not.toBe(stored[1].id)

      yield* todos.update({ sessionID, todos: [] })
      expect(yield* todos.get(sessionID)).toEqual([])
      expect(published.map((event) => event.data)).toEqual([
        {
          sessionID,
          todos: [
            { id: expect.stringMatching(/^td_[0-9a-f]{8}$/), content: "second", status: "pending", priority: "low" },
            { id: expect.stringMatching(/^td_[0-9a-f]{8}$/), content: "first", status: "in_progress", priority: "high" },
          ],
        },
        {
          sessionID,
          todos: [
            { id: stored[1].id, content: "first", status: "completed", priority: "high" },
            { id: expect.stringMatching(/^td_[0-9a-f]{8}$/), content: "replacement", status: "completed", priority: "medium" },
          ],
        },
        { sessionID, todos: [] },
      ])
    }),
  )

  it.effect("lazily assigns ids to rows written without them", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const todos = yield* SessionTodo.Service
      yield* db
        .insert(TodoTable)
        .values({ session_id: sessionID, content: "legacy", status: "pending", priority: "low", position: 0 })
        .run()
        .pipe(Effect.orDie)
      const read = yield* todos.get(sessionID)
      expect(read).toHaveLength(1)
      expect(read[0]!.id).toStartWith("td_")
      // the read repairs addressing in memory only; the stored row still has no id
      const rows = yield* db.select().from(TodoTable).all().pipe(Effect.orDie)
      expect(rows[0]!.id).toBeNull()
    }),
  )

  it.effect("persists phase labels and renders them as an ordered snapshot", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service
      const list = [
        { content: "schema", status: "in_progress" as const, priority: "high" as const, phase: "Phase 1: schema" },
        { content: "migration", status: "pending" as const, priority: "medium" as const, phase: "Phase 1: schema" },
        { content: "wiring", status: "pending" as const, priority: "low" as const, phase: "Phase 2: wiring" },
      ]
      yield* todos.update({ sessionID, todos: list })
      const stored = yield* todos.get(sessionID)
      expect(withoutIds(stored)).toEqual(list)
      expect(SessionTodo.snapshot(stored)).toBe(
        ["### Phase 1: schema", "1. [>] schema", "2. [ ] migration", "### Phase 2: wiring", "1. [ ] wiring"].join("\n"),
      )
      expect(SessionTodo.snapshot(stored, { ids: true })).toBe(
        [
          "### Phase 1: schema",
          `1. [>] (${stored[0]!.id}) schema`,
          `2. [ ] (${stored[1]!.id}) migration`,
          "### Phase 2: wiring",
          `1. [ ] (${stored[2]!.id}) wiring`,
        ].join("\n"),
      )
    }),
  )
})

describe("SessionTodo.ensureIds", () => {
  const todo = (content: string) => ({ content, status: "pending" as const, priority: "low" as const })

  test("mints unique ids only for items missing them", () => {
    const kept = { ...todo("kept"), id: SessionTodo.ID.create() }
    const result = SessionTodo.ensureIds([kept, todo("minted"), todo("minted too")])
    expect(result[0]!.id).toBe(kept.id)
    expect(result[1]!.id).toMatch(/^td_[0-9a-f]{8}$/)
    expect(result[2]!.id).toMatch(/^td_[0-9a-f]{8}$/)
    expect(new Set(result.map((item) => item.id)).size).toBe(3)
  })
})

describe("SessionTodo.validate", () => {
  const todo = (status: SessionTodo.Info["status"]) => ({ content: status, status, priority: "low" as const })

  test("allows a single active task, all-pending lists, and fully settled lists", () => {
    expect(SessionTodo.validate([todo("in_progress"), todo("pending")])).toBeUndefined()
    expect(SessionTodo.validate([todo("pending"), todo("pending")])).toBeUndefined()
    expect(SessionTodo.validate([todo("completed"), todo("cancelled")])).toBeUndefined()
    expect(SessionTodo.validate([])).toBeUndefined()
    expect(SessionTodo.snapshot([])).toBe("")
  })

  test("rejects multiple in-progress tasks", () => {
    expect(SessionTodo.validate([todo("in_progress"), todo("in_progress")])).toContain("Only one task")
  })

  test("rejects mid-flight work with nothing active", () => {
    expect(SessionTodo.validate([todo("completed"), todo("pending")])).toContain("mid-flight")
  })
})
