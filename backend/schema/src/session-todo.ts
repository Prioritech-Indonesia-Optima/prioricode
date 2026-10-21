export * as SessionTodo from "./session-todo"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"
import { NonNegativeInt, optional, statics } from "./schema"

export const Status = Schema.Literals(["pending", "in_progress", "completed", "cancelled"])
export const Priority = Schema.Literals(["high", "medium", "low"])

export const ID = Schema.String.check(Schema.isPattern(/^td_[0-9a-f]{8}$/)).pipe(
  Schema.brand("TodoID"),
  statics((schema) => {
    const create = () =>
      schema.make(
        "td_" +
          Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      )
    return { create }
  }),
)
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: optional(ID).annotate({
    description:
      "Stable server-assigned id used to address this item with todowrite ops. Omit it on new items; the server mints one and returns it in every response.",
  }),
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Status.annotate({ description: "Task state; exactly one item may be in_progress while work remains" }),
  priority: Priority.annotate({ description: "Priority level of the task" }),
  phase: optional(Schema.String).annotate({
    description: "Legacy grouping label — superseded by depth; retained for compatibility.",
  }),
  depth: optional(NonNegativeInt).annotate({
    description:
      'Nesting level in the plan outline: 0 = the objective, 1 = a stage, 2 = a concrete step. Keep it proportional to the work — most tasks are a 0 with a few 1s/2s; add stages only when the work genuinely has them. Never encode the level in content (no "Phase 1:" prefixes).',
  }),
}).annotate({ identifier: "Todo" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

const Updated = define({
  type: "todo.updated",
  schema: {
    sessionID: SessionID,
    todos: Schema.Array(Info),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
