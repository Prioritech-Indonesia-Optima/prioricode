export * as TodoWriteTool from "./todowrite"

import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Permission } from "../permission"
import { PermissionFailure } from "./permission-failure"
import { SessionTodo } from "../session/todo"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "todowrite"

export const Input = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info).annotate({
    description:
      "The complete updated todo list. Every task: content, one of pending|in_progress|completed|cancelled, priority high|medium|low, and an optional phase label that groups consecutive tasks into one collapsible section.",
  }),
})

export const Output = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
})
export type Output = typeof Output.Type

// Tool settlement hands `toModelOutput` the encoded side, where the branded id erases to a plain string.
export const toModelOutput = (output: Schema.Codec.Encoded<typeof Output>) =>
  JSON.stringify(output.todos, null, 2)

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const todos = yield* SessionTodo.Service
    const permission = yield* Permission.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            'Create and maintain the session todo list — the user\'s live view of your progress. Any request that modifies files or spans multiple steps requires a todo list, written before the first change. Structure work as phases: give each task an optional phase label; consecutive tasks sharing a label render as one collapsible group (e.g. "Phase 1: schema", "Phase 2: tools"). Statuses are pending, in_progress, completed, cancelled: keep exactly one task in_progress while work remains and mark tasks completed the moment each is truly done — never batched. The tool rejects lists with multiple in_progress items or with work in flight and nothing active. Update the list in real time: capture arriving instructions as todos, append follow-ups you discover, remove tasks that are no longer needed, and never mark completed without having done and verified the work. The list is persisted independently of the conversation and survives compaction and restarts; keep it authoritative — it is what you and the user both rely on.',
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const problem = SessionTodo.validate(input.todos)
              if (problem) return yield* Effect.fail(Tool.failure(`Invalid todo list: ${problem}`))
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
              yield* todos.update({ sessionID: context.sessionID, todos: input.todos })
              return { todos: input.todos }
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
