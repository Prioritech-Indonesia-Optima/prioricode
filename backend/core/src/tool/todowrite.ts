export * as TodoWriteTool from "./todowrite"

import { Effect, Layer } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Permission } from "../permission"
import { PermissionFailure } from "./permission-failure"
import { SessionTodo } from "../session/todo"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { DESCRIPTION, Input, Output, isMutation, toModelOutput } from "./todowrite-input"

export const name = "todowrite"
export { DESCRIPTION, Input, Output, toModelOutput }

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const todos = yield* SessionTodo.Service
    const permission = yield* Permission.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: DESCRIPTION,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const result = SessionTodo.apply(yield* todos.get(context.sessionID), input)
              if (!result.ok) return yield* Effect.fail(Tool.failure(result.text))
              if (isMutation(input)) {
                yield* permission
                  .assert({
                    action: name,
                    resources: ["*"],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                  })
                  .pipe(Effect.mapError(PermissionFailure.fromError))
                yield* todos.update({ sessionID: context.sessionID, todos: result.todos })
              }
              return { todos: result.todos, text: result.text }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof Tool.Failure ? error : Tool.failure("Unable to update todos", error),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/todowrite",
  layer,
  deps: [ToolRegistry.node, Permission.node, SessionTodo.node],
})
