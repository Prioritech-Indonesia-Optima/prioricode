export * as SessionTodo from "./todo"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { SessionTodo } from "@prioricode/schema/session-todo"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventBus } from "../event"
import { SessionSchema } from "./schema"
import { TodoTable } from "./sql"

export const Info = SessionTodo.Info
export type Info = typeof Info.Type
export const Event = SessionTodo.Event

export const validate = (todos: ReadonlyArray<Info>) => {
  const count = (status: Info["status"]) => todos.filter((todo) => todo.status === status).length
  const active = count("in_progress")
  if (active > 1) return "Only one task may be in_progress at a time — set the other active tasks back to pending."
  if (active === 0 && count("pending") > 0 && count("completed") + count("cancelled") > 0)
    return "Work is mid-flight: mark exactly one pending task in_progress in this list."
  return undefined
}

const MARK: Record<Info["status"], string> = { pending: "[ ]", in_progress: "[>]", completed: "[x]", cancelled: "[-]" }

export const snapshot = (todos: ReadonlyArray<Info>) => {
  if (todos.length === 0) return ""
  const lines: string[] = []
  let phase: string | undefined
  let index = 0
  for (const todo of todos) {
    if (todo.phase !== phase) {
      phase = todo.phase
      index = 0
      if (phase) lines.push(`### ${phase}`)
    }
    index += 1
    lines.push(`${index}. ${MARK[todo.status]} ${todo.content}`)
  }
  return lines.join("\n")
}

export interface Interface {
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly todos: ReadonlyArray<Info>
  }) => Effect.Effect<void>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/v2/SessionTodo") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventBus.Service

    const update = Effect.fn("SessionTodo.update")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly todos: ReadonlyArray<Info>
    }) {
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
            if (input.todos.length === 0) return
            yield* tx
              .insert(TodoTable)
              .values(
                input.todos.map((todo, position) => ({
                  session_id: input.sessionID,
                  content: todo.content,
                  status: todo.status,
                  priority: todo.priority,
                  phase: todo.phase,
                  position,
                })),
              )
              .run()
          }),
        )
        .pipe(Effect.orDie)
      yield* events.publish(Event.Updated, input)
    })

    const get = Effect.fn("SessionTodo.get")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .select()
        .from(TodoTable)
        .where(eq(TodoTable.session_id, sessionID))
        .orderBy(asc(TodoTable.position))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => ({
        content: row.content,
        status: row.status,
        priority: row.priority,
        phase: row.phase ?? undefined,
      }))
    })

    return Service.of({ update, get })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [EventBus.node, Database.node] })
