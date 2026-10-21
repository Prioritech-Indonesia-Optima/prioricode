import { LayerNode } from "@prioricode/core/effect/layer-node"
import { SessionID } from "./schema"
import { Clock, Effect, Layer, Context } from "effect"
import { Database } from "@prioricode/core/database/database"
import { eq } from "drizzle-orm"
import { asc } from "drizzle-orm"
import { TodoTable } from "@prioricode/core/session/sql"
import { EventBridge } from "@/event-v2-bridge"
import { SessionTodo } from "@prioricode/schema/session-todo"
import { SessionTodo as SessionTodoCore } from "@prioricode/core/session/todo"

export const Info = SessionTodo.Info
export type Info = SessionTodo.Info

export const Event = SessionTodo.Event
export const ID = SessionTodoCore.ID
export const validate = SessionTodoCore.validate
export const snapshot = SessionTodoCore.snapshot
export const ensureIds = SessionTodoCore.ensureIds
export const toInfo = SessionTodoCore.toInfo
export const apply = SessionTodoCore.apply
export const reminderText = SessionTodoCore.reminderText
export const STALE_AFTER_MS = SessionTodoCore.STALE_AFTER_MS
export const REMINDER_HEADER = SessionTodoCore.REMINDER_HEADER

export interface Interface {
  readonly update: (input: { sessionID: SessionID; todos: ReadonlyArray<Info> }) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
  /** Reminder text when an unfinished list has gone unattended; "" when current. */
  readonly reminder: (sessionID: SessionID) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/SessionTodo") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventBridge.Service
    const { db } = yield* Database.Service

    const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: ReadonlyArray<Info> }) {
      const todos = ensureIds(input.todos)
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
            if (todos.length === 0) return
            yield* tx
              .insert(TodoTable)
              .values(
                todos.map((todo, position) => ({
                  session_id: input.sessionID,
                  id: todo.id,
                  content: todo.content,
                  status: todo.status,
                  priority: todo.priority,
                  phase: todo.phase,
                  depth: todo.depth,
                  position,
                })),
              )
              .run()
          }),
        )
        .pipe(Effect.orDie)
      yield* events.publish(Event.Updated, { sessionID: input.sessionID, todos })
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
      const rows = yield* db
        .select()
        .from(TodoTable)
        .where(eq(TodoTable.session_id, sessionID))
        .orderBy(asc(TodoTable.position))
        .all()
        .pipe(Effect.orDie)
      return ensureIds(rows.map(toInfo))
    })

    const reminder = Effect.fn("Todo.reminder")(function* (sessionID: SessionID) {
      const rows = yield* db
        .select({ status: TodoTable.status, updated: TodoTable.time_updated })
        .from(TodoTable)
        .where(eq(TodoTable.session_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      if (!rows.some((row) => row.status === "pending" || row.status === "in_progress")) return ""
      const touched = Math.max(...rows.map((row) => row.updated))
      const now = yield* Clock.currentTimeMillis
      return reminderText(yield* get(sessionID), touched, now)
    })

    return Service.of({ update, get, reminder })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventBridge.node, Database.node] })

export * as Todo from "./todo"
