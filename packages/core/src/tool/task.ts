/**
 * Model-facing V2 subagent leaf. Launches or resumes one specialist child
 * Session, runs it to a settle, and returns its final text so the parent can
 * verify and continue. Background children are process-local jobs that notify
 * the parent through a durable steering prompt when they settle.
 */
export * as TaskTool from "./task"

import { ToolFailure } from "@prioricode/llm"
import { Effect, Exit, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { AgentV2 } from "../agent"
import { BackgroundJob } from "../background-job"
import { SessionExecution } from "../session/execution"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { SessionV2 } from "../session"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "task"

export const description = `Launch one specialist subagent as a separate child Session and return its final result.

Available subagent types and their purposes appear in the system context. Use "general" for multi-step research and implementation work; use "explore" for fast read-only codebase questions and specify the desired thoroughness level.

Set a short (3-5 word) description. Provide a self-contained prompt: the subagent only sees the session history it inherits plus this prompt, so include every file path, constraint, and finding it needs to act on. The subagent cannot ask the user questions.

Pass task_id to continue a previous subagent Session of this Session with its context intact instead of starting fresh.

Use background=true only for independent work that can run while you continue elsewhere; you will be notified automatically when it finishes. In foreground mode the result returns after the subagent settles — issue multiple task calls in one step to parallelize independent work.

Verify subagent output yourself before relying on it: it is advice from another agent, not ground truth.`

export const Input = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 word) description of the task" }),
  prompt: Schema.String.annotate({ description: "The self-contained task for the agent to perform" }),
  subagent_type: Schema.String.pipe(Schema.optional).annotate({
    description: "Specialized agent to use (default: general). Must be a subagent-capable agent from the system context.",
  }),
  task_id: Schema.String.pipe(Schema.optional).annotate({
    description: "Continue a previous subagent Session of this Session instead of creating a fresh one.",
  }),
  background: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Run the subagent asynchronously and be notified when it finishes (default: false).",
  }),
})

export const Output = Schema.Struct({
  sessionID: Schema.String,
  agent: Schema.String,
  state: Schema.Literals(["running", "completed", "error"]),
  text: Schema.String,
})
export type Output = typeof Output.Type

const runningNotice = (sessionID: string) =>
  [
    `<task id="${sessionID}" state="running">`,
    "The subagent is working in the background. You will be notified automatically when it finishes.",
    "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
    "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
    "</task>",
  ].join("\n")

const resultNotice = (sessionID: string, state: "completed" | "error", text: string) => {
  const tag = state === "error" ? "task_error" : "task_result"
  return [`<task id="${sessionID}" state="${state}">`, `<${tag}>`, text, `</${tag}>`, "</task>"].join("\n")
}

const completionNotice = (sessionID: string, description: string, state: "completed" | "error", text: string) => {
  const tag = state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${sessionID}" state="${state}">`,
    `<summary>Background task ${state === "error" ? "failed" : "completed"}: ${description}</summary>`,
    `<${tag}>`,
    text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

function finalAnswer(messages: ReadonlyArray<SessionMessage.Message>) {
  const last = messages.findLast((message) => message.type === "assistant")
  if (last === undefined || last.type !== "assistant") return undefined
  const text = last.content
    .filter((content): content is Extract<(typeof last.content)[number], { type: "text" }> => content.type === "text")
    .map((content) => content.text)
    .join("\n")
  return { text, failed: last.finish === "error" }
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const agents = yield* AgentV2.Service
    const sessions = yield* SessionV2.Service
    const execution = yield* SessionExecution.Service
    const background = yield* BackgroundJob.Service

    const settle = Effect.fn("TaskTool.settle")(function* (sessionID: SessionSchema.ID) {
      const failed = yield* execution
        .resume(sessionID)
        .pipe(
          Effect.as(false),
          Effect.catch(() => Effect.succeed(true)),
        )
      const answer = yield* sessions
        .context(sessionID)
        .pipe(
          Effect.map(finalAnswer),
          Effect.catch(() => Effect.succeed(undefined)),
        )
      if (failed || answer === undefined || answer.failed)
        return {
          state: "error" as const,
          text:
            answer?.text ||
            (failed ? "The subagent run failed; see its Session transcript for details." : "The subagent finished without a text response."),
        }
      return { state: "completed" as const, text: answer.text }
    })

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const parent = yield* sessions
                .get(context.sessionID)
                .pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (parent === undefined)
                return yield* new ToolFailure({ message: "Task requires a parent Session that could not be loaded." })
              if (parent.parentID !== undefined)
                return yield* new ToolFailure({ message: "Subagent Sessions cannot launch further subagents." })

              const subagentID = AgentV2.ID.make(input.subagent_type ?? "general")
              const info = yield* agents.resolve(subagentID)
              if (info === undefined || info.mode === "primary") {
                const subagents = (yield* agents.all())
                  .filter((agent) => agent.mode !== "primary" && !agent.hidden)
                  .map((agent) => agent.id)
                return yield* new ToolFailure({
                  message: `Unknown subagent type ${subagentID}. Available subagents: ${subagents.join(", ") || "none configured"}.`,
                })
              }

              let child: SessionSchema.Info | undefined
              if (input.task_id !== undefined) {
                const found = yield* sessions
                  .get(SessionSchema.ID.make(input.task_id))
                  .pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (found === undefined || found.parentID !== context.sessionID)
                  return yield* new ToolFailure({
                    message: `Unable to resume task_id ${input.task_id}: Session not found or not owned by this Session.`,
                  })
                child = found
              } else {
                child = yield* sessions
                  .create({
                    location: parent.location,
                    agent: subagentID,
                    model: parent.model,
                    parentID: context.sessionID,
                    title: `${input.description} (@${subagentID} subagent)`,
                  })
                  .pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (child === undefined)
                  return yield* new ToolFailure({ message: `Unable to create the ${subagentID} subagent Session.` })
              }

              const childID = child.id
              const admitted = yield* sessions
                .prompt({ sessionID: childID, prompt: { text: input.prompt }, delivery: "queue", resume: false })
                .pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (admitted === undefined)
                return yield* new ToolFailure({
                  message: "Unable to admit the subagent prompt (Session changed underneath this call).",
                })

              if (input.background === true) {
                const notify = settle(childID).pipe(
                  Effect.flatMap((result) =>
                    sessions
                      .prompt({
                        sessionID: context.sessionID,
                        prompt: { text: completionNotice(childID, input.description, result.state, result.text) },
                        delivery: "steer",
                        resume: true,
                      })
                      .pipe(Effect.as("notified")),
                  ),
                  Effect.catch(() =>
                    sessions
                      .prompt({
                        sessionID: context.sessionID,
                        prompt: {
                          text: completionNotice(
                            childID,
                            input.description,
                            "error",
                            "The background subagent was interrupted before it settled.",
                          ),
                        },
                        delivery: "steer",
                        resume: true,
                      })
                      .pipe(Effect.as("notified")),
                  ),
                )
                const extended = yield* background.extend({ id: childID, run: notify })
                if (!extended)
                  yield* background.start({
                    id: childID,
                    type: name,
                    title: input.description,
                    metadata: { parentSessionID: context.sessionID, agent: subagentID },
                    run: notify,
                  })
                return {
                  sessionID: childID,
                  agent: subagentID,
                  state: "running" as const,
                  text: runningNotice(childID),
                }
              }

              const settled = yield* Effect.acquireUseRelease(
                Effect.succeed(childID),
                () => settle(childID),
                (sessionID, exit) =>
                  Exit.hasInterrupts(exit) ? execution.interrupt(sessionID) : Effect.void,
              )
              return {
                sessionID: childID,
                agent: subagentID,
                state: settled.state,
                text: resultNotice(childID, settled.state, settled.text),
              }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/task",
  layer,
  deps: [ToolRegistry.node, AgentV2.node, SessionV2.node, SessionExecution.node, BackgroundJob.node],
})
