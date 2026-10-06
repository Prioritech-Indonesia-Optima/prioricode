/**
 * Model-facing V2 plan-mode transitions. Each tool asks the user through the
 * durable question flow, then switches the Session agent and admits a synthetic
 * steering instruction so the model sees the transition as user-approved.
 *
 * These tools write through leaf services only. The SessionV2 facade layer
 * resolves the LocationServiceMap, and the map in turn builds this Location's
 * tool graph, so capturing the facade here would construct a real layer cycle
 * (and tsgo flags the type recursion). The same durable operations are
 * reproduced exactly: publish AgentSwitched for the projector, and admit a
 * steer for the runner to promote at the next Safe Provider-Turn Boundary.
 */
import { DateTime, Effect, Layer, Schema } from "effect"
import { ToolFailure } from "@prioricode/llm"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeLocationNode } from "../effect/app-node"
import { QuestionV2 } from "../question"
import { SessionEvent } from "../session/event"
import { SessionInput } from "../session/input"
import { SessionMessage } from "../session/message"
import { SessionStore } from "../session/store"
import { Prompt } from "../session/prompt"
import { SessionSchema } from "../session/schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export * as PlanTool from "./plan"

const ENTER_DESCRIPTION = `Use this tool to suggest switching to plan agent when the user's request would benefit from planning before implementation.

If they explicitly mention wanting to create a plan ALWAYS call this tool first.

This tool will ask the user if they want to switch to plan agent.`

const EXIT_DESCRIPTION = `Use this tool when you have finished planning and the user should decide whether to begin implementing.

After presenting the plan, ask the user to approve switching to the build agent before writing any code. Do not call this tool without first describing the plan to the user.`

const transition = Effect.fnUntraced(function* (
  question: QuestionV2.Interface,
  write: (sessionID: SessionSchema.ID, agent: string, instruction: string) => Effect.Effect<void, ToolFailure>,
  request: {
    readonly sessionID: SessionSchema.ID
    readonly assistantMessageID: SessionMessage.ID
    readonly toolCallID: string
  },
  agent: string,
  prompt: QuestionV2.Prompt,
  declinedMessage: string,
  approvedMessage: string,
  instruction: string,
) {
  const answers = yield* question
    .ask({
      sessionID: request.sessionID,
      questions: [prompt],
      tool: { messageID: request.assistantMessageID, callID: request.toolCallID },
    })
    .pipe(
      Effect.catchTag("QuestionV2.RejectedError", () =>
        Effect.fail(
          new ToolFailure({
            message:
              "The user rejected the plan-mode transition. Continue with the current agent; do not call this tool again for it.",
          }),
        ),
      ),
    )
  if (!answers[0]?.some((answer) => answer.toLowerCase().includes("yes")))
    return { approved: false as const, message: declinedMessage }
  yield* write(request.sessionID, agent, instruction)
  return { approved: true as const, message: approvedMessage }
})

const output = Schema.Struct({ approved: Schema.Boolean, message: Schema.String })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const question = yield* QuestionV2.Service
    const events = yield* EventV2.Service
    const store = yield* SessionStore.Service
    const { db } = yield* Database.Service

    const write = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, agent: string, instruction: string) {
      if ((yield* store.get(sessionID)) === undefined)
        return yield* new ToolFailure({
          message: `Session ${sessionID} no longer exists. The plan-mode transition did not apply.`,
        })
      yield* events.publish(SessionEvent.AgentSwitched, {
        sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        agent,
      })
      yield* SessionInput.admit(db, events, {
        id: SessionMessage.ID.create(),
        sessionID,
        prompt: Prompt.make({ text: instruction }),
        delivery: "steer",
      }).pipe(Effect.asVoid)
    })

    yield* tools
      .register({
        plan_enter: Tool.make({
          description: ENTER_DESCRIPTION,
          input: Schema.Struct({}),
          output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.message }],
          execute: (_input, context) =>
            transition(
              question,
              (sessionID, agent, instruction) => write(sessionID, agent, instruction),
              context,
              "plan",
              {
                question:
                  "This task looks complex. Switch to the plan agent to research and design before implementing?",
                header: "Plan Agent",
                options: [
                  { label: "Yes", description: "Switch to plan agent to research and create a plan" },
                  { label: "No", description: "Stay with the current agent and implement directly" },
                ],
              },
              "The user chose to stay with the current agent. Do not call plan_enter again for this task.",
              "User approved switching to plan agent. Wait for further instructions.",
              "Switched to plan agent. Research the request, write an actionable implementation plan to the plan file, and present it for approval before making any edits.",
            ),
        }),
        plan_exit: Tool.make({
          description: EXIT_DESCRIPTION,
          input: Schema.Struct({}),
          output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.message }],
          execute: (_input, context) =>
            transition(
              question,
              (sessionID, agent, instruction) => write(sessionID, agent, instruction),
              context,
              "build",
              {
                question: "The plan is complete. Would you like to switch to the build agent and start implementing?",
                header: "Build Agent",
                options: [
                  { label: "Yes", description: "Switch to build agent and start implementing the plan" },
                  { label: "No", description: "Stay with plan agent to continue refining the plan" },
                ],
              },
              "The user chose to keep planning. Refine the plan and call plan_exit again only after presenting the updated plan.",
              "User approved switching to build agent. Wait for further instructions.",
              "The plan has been approved by the user. Execute it with the build agent now.",
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/plan",
  layer,
  deps: [ToolRegistry.node, QuestionV2.node, EventV2.node, Database.node, SessionStore.node],
})
