export * as SessionTodo from "./todo"

import { asc, eq } from "drizzle-orm"
import { Clock, Context, Effect, Layer } from "effect"
import { SessionTodo } from "@prioricode/schema/session-todo"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventBus } from "../event"
import { SessionSchema } from "./schema"
import { TodoTable } from "./sql"

export const Info = SessionTodo.Info
export type Info = typeof Info.Type
export const ID = SessionTodo.ID
export type ID = SessionTodo.ID
export const Status = SessionTodo.Status
export const Priority = SessionTodo.Priority
export const Event = SessionTodo.Event

export const validate = (todos: ReadonlyArray<Info>) => {
  const count = (status: Info["status"]) => todos.filter((todo) => todo.status === status).length
  const active = count("in_progress")
  if (active > 1) return "Only one task may be in_progress at a time — set the other active tasks back to pending."
  if (active === 0 && count("pending") > 0 && count("completed") + count("cancelled") > 0)
    return "Work is mid-flight: mark exactly one pending task in_progress in this list."
  return undefined
}

/** Assign a stable id to every item missing one, keeping ids unique within the list. */
export const ensureIds = (todos: ReadonlyArray<Info>) => {
  const taken = new Set<SessionTodo.ID>(todos.flatMap((todo) => (todo.id === undefined ? [] : [todo.id])))
  const mint = () => {
    let id = SessionTodo.ID.create()
    while (taken.has(id)) id = SessionTodo.ID.create()
    taken.add(id)
    return id
  }
  return todos.map((todo) => (todo.id === undefined ? { ...todo, id: mint() } : todo))
}

export const toInfo = (row: {
  id: string | null
  content: string
  status: Info["status"]
  priority: Info["priority"]
  phase: string | null
}): Info => ({
  ...(row.id === null ? {} : { id: row.id as SessionTodo.ID }),
  content: row.content,
  status: row.status,
  priority: row.priority,
  phase: row.phase ?? undefined,
})

const MARK: Record<Info["status"], string> = { pending: "[ ]", in_progress: "[>]", completed: "[x]", cancelled: "[-]" }

/** How long an unfinished, untouched todo list waits before it nags via context. */
export const STALE_AFTER_MS = 120_000

/** Stable prefix of the unattended-list reminder; dedup scanners match on it. */
export const REMINDER_HEADER = "The session todo list has unfinished items and has gone unattended."

export const reminderText = (todos: ReadonlyArray<Info>, touchedAt: number, now: number) => {
  const open = todos.filter((todo) => todo.status === "pending" || todo.status === "in_progress")
  if (open.length === 0 || touchedAt === 0 || now - touchedAt < STALE_AFTER_MS) return ""
  return [
    REMINDER_HEADER,
    "The stored list — not your recollection — is the plan in force:\n\n" + snapshot(todos, { ids: true }),
    'Mutate it in place with todowrite (status/add/edit/remove) as work progresses, and mark items completed only when they are truly done and verified.',
  ].join("\n\n")
}

export const snapshot = (todos: ReadonlyArray<Info>, options?: { readonly ids?: boolean }) => {
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
    lines.push(`${index}. ${MARK[todo.status]}${options?.ids && todo.id ? ` (${todo.id})` : ""} ${todo.content}`)
  }
  return lines.join("\n")
}

export const Action = ["view", "add", "status", "edit", "remove", "replace"] as const
export type Action = (typeof Action)[number]

export interface OpInput {
  readonly action?: Action
  readonly todos?: ReadonlyArray<Info>
  readonly confirm?: ReadonlyArray<string>
  readonly add?: ReadonlyArray<{
    readonly content: string
    readonly priority?: Info["priority"]
    readonly status?: Info["status"]
    readonly phase?: string
    readonly after?: string
  }>
  readonly status?: ReadonlyArray<{ readonly id: string; readonly status: Info["status"] }>
  readonly edit?: ReadonlyArray<{
    readonly id: string
    readonly content?: string
    readonly phase?: string
    readonly priority?: Info["priority"]
  }>
  readonly remove?: ReadonlyArray<string>
}

export type ApplyResult =
  | { readonly ok: true; readonly todos: ReadonlyArray<Info>; readonly text: string }
  | { readonly ok: false; readonly reason: string; readonly todos: ReadonlyArray<Info>; readonly text: string }

const unfinished = (todos: ReadonlyArray<Info>) =>
  todos.filter((todo) => todo.status === "pending" || todo.status === "in_progress")

const render = (todos: ReadonlyArray<Info>) =>
  todos.length === 0 ? "(the list is empty)" : snapshot(todos, { ids: true })

const rejected = (reason: string, current: ReadonlyArray<Info>): ApplyResult => ({
  ok: false,
  reason,
  todos: current,
  text: `${reason}\n\nLive todo list — address items by their (td_…) id; the list wins over your recollection:\n${render(current)}`,
})

const summary = (todos: ReadonlyArray<Info>) => {
  const count = (status: Info["status"]) => todos.filter((todo) => todo.status === status).length
  return `${count("pending")} pending, ${count("in_progress")} in progress, ${count("completed")} completed, ${count(
    "cancelled",
  )} cancelled (${todos.length} total)`
}

const phaseWarning = (todos: ReadonlyArray<Info>) => {
  const blocks = new Map<string, number>()
  let previous: string | undefined
  for (const todo of todos) {
    if (todo.phase === previous || todo.phase === undefined) {
      previous = todo.phase
      continue
    }
    previous = todo.phase
    blocks.set(todo.phase, (blocks.get(todo.phase) ?? 0) + 1)
  }
  const split = [...blocks].filter(([, count]) => count > 1)
  if (split.length === 0) return []
  return split.map(
    ([label]) =>
      `Warning: phase "${label}" appears in separate blocks; renderers show one group per block. Keep its tasks consecutive or rename the later block.`,
  )
}

const applied = (todos: ReadonlyArray<Info>, headline: string): ApplyResult => ({
  ok: true,
  todos,
  text: [`${headline} — ${summary(todos)}`, ...phaseWarning(todos), "", render(todos)].join("\n"),
})

/**
 * Applies one todowrite operation to the live list, purely. `current` is the
 * stored list; ids are ensured so legacy id-less rows stay addressable. The
 * result text is model-facing: accepted ops echo the fresh checklist, rejected
 * ones carry the reason plus the live list so the model re-grounds in one round
 * trip. Only `replace` may produce a brand-new list, and only after the caller
 * confirms the exact set of unfinished ids being discarded.
 */
export const apply = (current: ReadonlyArray<Info>, input: OpInput): ApplyResult => {
  const base = ensureIds(current)
  const action = input.action ?? (input.todos === undefined ? undefined : "replace")
  if (action === undefined)
    return rejected(
      "Missing action: pass view, add, status, edit, remove, or replace (replace needs the complete `todos` list).",
      base,
    )
  if (action === "view") return applied(base, "Current todo list")
  if (action === "replace") {
    if (input.todos === undefined) return rejected("`replace` needs the complete new `todos` list.", base)
    const discarded = unfinished(base)
    if (discarded.length > 0) {
      const wanted = new Set(discarded.map((todo) => todo.id!))
      const given = new Set(input.confirm ?? [])
      if (wanted.size !== given.size || [...wanted].some((id) => !given.has(id)))
        return rejected(
          `This session has ${discarded.length} unfinished task(s). Replacing the list discards them:\n${snapshot(
            discarded,
            { ids: true },
          )}\n\nIf the user pivoted to genuinely new work, resubmit replace with \`confirm\` set to exactly these ids: ${JSON.stringify(
            [...wanted],
            null,
            0,
          )}. Otherwise mutate in place with add/status/edit/remove.`,
          base,
        )
      const fresh = ensureIds(input.todos.map((todo) => ({ ...todo, id: undefined })))
      const problem = validate(fresh)
      if (problem) return rejected(`Invalid replacement list: ${problem}`, base)
      return applied(fresh, "Replaced the todo list with a new plan")
    }
    const fresh = ensureIds(input.todos)
    const problem = validate(fresh)
    if (problem) return rejected(`Invalid todo list: ${problem}`, base)
    return applied(fresh, "Seeded the todo list")
  }
  if (action === "add") {
    if (!input.add || input.add.length === 0) return rejected("`add` needs at least one item.", base)
    const next = [...base]
    const offsets = new Map<string, number>()
    for (const item of input.add) {
      const position =
        item.after === undefined
          ? next.length
          : (() => {
              const index = next.findIndex((todo) => todo.id === item.after)
              return index === -1 ? -1 : index + 1 + (offsets.get(item.after) ?? 0)
            })()
      if (position === -1) return rejected(`Unknown todo id in add.after: ${item.after}`, base)
      if (item.after !== undefined) offsets.set(item.after, (offsets.get(item.after) ?? 0) + 1)
      next.splice(position, 0, {
        content: item.content,
        status: item.status ?? "pending",
        priority: item.priority ?? "medium",
        phase: item.phase,
      })
    }
    const fresh = ensureIds(next)
    const problem = validate(fresh)
    if (problem) return rejected(`Adding these items leaves the list invalid: ${problem}`, base)
    return applied(fresh, `Added ${input.add.length} item(s)`)
  }
  if (action === "status") {
    if (!input.status || input.status.length === 0)
      return rejected("`status` needs at least one {id, status} change.", base)
    const missing = [...new Set(input.status.map((change) => change.id))].filter(
      (id) => !base.some((todo) => todo.id === id),
    )
    if (missing.length > 0) return rejected(`Unknown todo id(s): ${missing.join(", ")}`, base)
    const next = base.map((todo) => {
      const change = input.status!.find((candidate) => candidate.id === todo.id)
      return change ? { ...todo, status: change.status } : todo
    })
    const problem = validate(next)
    if (problem)
      return rejected(
        `${problem} Batch the whole transition into one status call (for example, complete the current task and start the next together).`,
        base,
      )
    return applied(next, `Updated ${input.status.length} item(s)`)
  }
  if (action === "edit") {
    if (!input.edit || input.edit.length === 0) return rejected("`edit` needs at least one patch.", base)
    const missing = [...new Set(input.edit.map((item) => item.id))].filter((id) => !base.some((todo) => todo.id === id))
    if (missing.length > 0) return rejected(`Unknown todo id(s): ${missing.join(", ")}`, base)
    const next = base.map((todo) => {
      const patch = input.edit!.find((candidate) => candidate.id === todo.id)
      if (!patch) return todo
      return {
        ...todo,
        content: patch.content ?? todo.content,
        priority: patch.priority ?? todo.priority,
        phase: patch.phase === undefined ? todo.phase : patch.phase === "" ? undefined : patch.phase,
      }
    })
    return applied(next, `Edited ${input.edit.length} item(s)`)
  }
  if (!input.remove || input.remove.length === 0) return rejected("`remove` needs at least one id.", base)
  const missing = [...new Set(input.remove)].filter((id) => !base.some((todo) => todo.id === id))
  if (missing.length > 0) return rejected(`Unknown todo id(s): ${missing.join(", ")}`, base)
  const set = new Set(input.remove)
  const next = base.filter((todo) => !set.has(todo.id!))
  const problem = validate(next)
  if (problem)
    return rejected(
      `Removing these items leaves the list invalid: ${problem} Cancel or re-status the affected items first, then remove.`,
      base,
    )
  return applied(next, `Removed ${input.remove.length} item(s)`)
}

export interface Interface {
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly todos: ReadonlyArray<Info>
  }) => Effect.Effect<void>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
  /** Reminder text when an unfinished list has gone unattended; "" when current. */
  readonly reminder: (sessionID: SessionSchema.ID) => Effect.Effect<string>
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
                  position,
                })),
              )
              .run()
          }),
        )
        .pipe(Effect.orDie)
      yield* events.publish(Event.Updated, { sessionID: input.sessionID, todos })
    })

    const get = Effect.fn("SessionTodo.get")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .select()
        .from(TodoTable)
        .where(eq(TodoTable.session_id, sessionID))
        .orderBy(asc(TodoTable.position))
        .all()
        .pipe(Effect.orDie)
      return ensureIds(rows.map(toInfo))
    })

    const reminder = Effect.fn("SessionTodo.reminder")(function* (sessionID: SessionSchema.ID) {
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

export const node = makeLocationNode({ service: Service, layer, deps: [EventBus.node, Database.node] })
