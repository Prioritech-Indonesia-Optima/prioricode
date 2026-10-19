export * as QuestionTool from "./question"

import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Permission } from "../permission"
import { PermissionFailure } from "./permission-failure"
import { Question } from "../question"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "question"

export const description = `Ask the user questions mid-execution: gather preferences, clarify ambiguous instructions, decide implementation choices, offer directions.

- Answers come back as arrays of labels; set multiple: true to allow several picks.
- custom is enabled by default and auto-adds a "Type your own answer" option — do not include "Other" or catch-alls.
- Put the recommended option first and append "(Recommended)" to its label.
- Ask only when the answer changes what you do — anything you can read, run, or search is not a question.
- A question is a tool call, not a closing line; never end a turn with a dangling one.`

export const Input = Schema.Struct({
  questions: Schema.Array(Question.Prompt).annotate({ description: "Questions to ask" }),
})

export const Output = Schema.Struct({
  answers: Schema.Array(Question.Answer),
})
export type Output = typeof Output.Type

export const toModelOutput = (questions: ReadonlyArray<Question.Prompt>, answers: ReadonlyArray<Question.Answer>) => {
  const formatted = questions
    .map(
      (question, index) =>
        `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
    )
    .join(", ")
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const question = yield* Question.Service
    const permission = yield* Permission.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ input, output }) => [
            { type: "text", text: toModelOutput(input.questions, output.answers) },
          ],
          execute: (input, context) =>
            permission
              .assert({
                action: "question",
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              .pipe(
                Effect.mapError(PermissionFailure.fromError),
                Effect.andThen(
                  question
                    .ask({
                      sessionID: context.sessionID,
                      questions: input.questions,
                      tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                    })
                    .pipe(Effect.orDie),
                ),
                Effect.map((answers) => ({ answers })),
              ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/question",
  layer,
  deps: [ToolRegistry.node, Permission.node, Question.node],
})
