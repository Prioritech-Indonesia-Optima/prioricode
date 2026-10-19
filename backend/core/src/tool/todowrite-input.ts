export * as TodoWriteInput from "./todowrite-input"

import { Schema } from "effect"
import { SessionTodo } from "../session/todo"
import DESCRIPTION from "./todowrite.txt"

export { DESCRIPTION }

export const AddItem = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  priority: Schema.optional(SessionTodo.Priority).annotate({ description: "Defaults to medium" }),
  status: Schema.optional(SessionTodo.Status).annotate({ description: "Defaults to pending" }),
  phase: Schema.optional(Schema.String).annotate({ description: "Phase label for grouping" }),
  after: Schema.optional(Schema.String).annotate({
    description: 'id of the item to insert behind ("td_…"); omit to append',
  }),
})

export const StatusChange = Schema.Struct({
  id: SessionTodo.ID.annotate({ description: "Item id from the live list" }),
  status: SessionTodo.Status.annotate({ description: "New state" }),
})

export const EditItem = Schema.Struct({
  id: SessionTodo.ID.annotate({ description: "Item id from the live list" }),
  content: Schema.optional(Schema.String),
  phase: Schema.optional(Schema.String).annotate({ description: 'New phase label; "" clears it' }),
  priority: Schema.optional(SessionTodo.Priority),
})

export const Input = Schema.Struct({
  action: Schema.optional(Schema.Literals(SessionTodo.Action)).annotate({
    description:
      'What to do: "view" the live list (read only), "add" items, "status" (checklist changes, batched), "edit" items, "remove" items, or "replace" the whole list (seeding a new objective or an acknowledged pivot only). Omitting action with a todos array means "replace"',
  }),
  todos: Schema.optional(Schema.Array(SessionTodo.Info)).annotate({
    description: "Complete replacement list — only valid for action=replace",
  }),
  confirm: Schema.optional(Schema.Array(SessionTodo.ID)).annotate({
    description: "For replace: the exact unfinished ids being discarded, echoed from the rejection",
  }),
  add: Schema.optional(Schema.Array(AddItem)).annotate({ description: "Items to add, in order" }),
  status: Schema.optional(Schema.Array(StatusChange)).annotate({
    description: "Status changes applied atomically to the live list",
  }),
  edit: Schema.optional(Schema.Array(EditItem)).annotate({ description: "Field patches applied atomically" }),
  remove: Schema.optional(Schema.Array(SessionTodo.ID)).annotate({ description: "Item ids to delete" }),
})
export type Input = typeof Input.Type

export const Output = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
  text: Schema.String,
})
export type Output = typeof Output.Type

// Tool settlement hands `toModelOutput` the encoded side, where the branded id erases to a plain string.
export const toModelOutput = (output: Schema.Codec.Encoded<typeof Output>) => output.text

export const isMutation = (input: typeof Input.Type) =>
  input.action === undefined ? input.todos !== undefined : input.action !== "view"
