import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { TodoWriteInput } from "@prioricode/core/tool/todowrite-input"
import { Todo } from "../session/todo"

export const Parameters = TodoWriteInput.Input

type Metadata = {
  todos: Todo.Info[]
}

export const TodoWriteTool = Tool.define<typeof Parameters, Metadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: TodoWriteInput.DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const result = Todo.apply(yield* todo.get(ctx.sessionID), params)
          if (!result.ok) throw new Error(result.text)

          if (TodoWriteInput.isMutation(params)) {
            yield* ctx.ask({
              permission: "todowrite",
              patterns: ["*"],
              always: ["*"],
              metadata: {},
            })

            yield* todo.update({
              sessionID: ctx.sessionID,
              todos: result.todos,
            })
          }

          return {
            title: `${result.todos.filter((x) => x.status !== "completed").length} todos`,
            output: result.text,
            metadata: {
              todos: [...result.todos],
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
