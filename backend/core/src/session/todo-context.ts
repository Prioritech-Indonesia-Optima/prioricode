/**
 * The live todo list as a Context Source — the notepad the agent cannot lose.
 * The value is the unattended-list reminder: an actively maintained list keeps
 * the source absent (no per-turn echo of work the model just wrote), while a
 * neglected unfinished list re-anchors the checklist at the next Safe
 * Provider-Turn Boundary and survives compaction through the epoch snapshot.
 */
export * as SessionTodoContext from "./todo-context"

import { Effect, Schema } from "effect"
import { SystemContext } from "../system-context/index"
import { SessionTodo } from "./todo"

export const key = SystemContext.Key.make("session/todo")

export const context = (reminder: string): SystemContext.SystemContext =>
  reminder === ""
    ? SystemContext.empty
    : SystemContext.make({
        key,
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed(reminder),
        baseline: (reminder) => reminder,
        update: (_previous, reminder) => reminder,
        removed: () =>
          "The unattended todo-list reminder no longer applies — the list is being maintained again or the work is finished.",
      })
