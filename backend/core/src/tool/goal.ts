/**
 * Model-facing durable session goal. set records the standing definition of
 * success, show reads it back, clear removes it. The goal is re-anchored into
 * the baseline system context every turn (see session/goal.ts), so it survives
 * compaction; finish-time gate evaluation of the goal (phase 5) reads the same
 * durable value.
 */
export * as GoalTool from "./goal"

import { DateTime, Effect, Layer, Schema } from "effect"
import { ToolFailure } from "@prioricode/llm"
import { EventV2 } from "../event"
import { makeLocationNode } from "../effect/app-node"
import { SessionEvent } from "../session/event"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { SessionStore } from "../session/store"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const ACTIONS = ["set", "show", "clear"] as const

const DESCRIPTION = `Manage the durable goal for this session.

- set: record the standing definition of success (objective: one concrete, checkable sentence describing what must be true when this session is done, plus done_when: how completion will be verified). The goal is re-injected every turn and survives compaction; a finish gate may later verify work against it.
- show: read the currently stored goal verbatim.
- clear: remove the goal (when the user abandons the objective, or it is achieved and no longer useful).

Set a goal when the user states an objective that spans multiple turns. Update it whenever the user changes the objective, and clear it when it no longer applies.`

const output = Schema.Struct({ active: Schema.Boolean, goal: Schema.String, message: Schema.String })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const events = yield* EventV2.Service
    const store = yield* SessionStore.Service

    const publish = (sessionID: SessionSchema.ID, goal: string) =>
      Effect.gen(function* () {
        yield* events
          .publish(SessionEvent.GoalSet, {
            sessionID,
            messageID: SessionMessage.ID.create(),
            timestamp: yield* DateTime.now,
            goal,
          })
          .pipe(Effect.orDie)
      })

    yield* tools
      .register({
        goal: Tool.make({
          description: DESCRIPTION,
          input: Schema.Struct({
            action: Schema.Literals(ACTIONS),
            objective: Schema.String.pipe(Schema.optional),
            done_when: Schema.String.pipe(Schema.optional),
          }),
          output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.message }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const session = yield* store.get(context.sessionID)
              if (session === undefined)
                return yield* new ToolFailure({
                  message: `Session ${context.sessionID} no longer exists; the goal did not apply.`,
                })
              if (input.action === "show") {
                const goal = session.goal ?? ""
                return {
                  active: goal !== "",
                  goal,
                  message: goal === "" ? "No goal is set for this session." : `Current goal:\n${goal}`,
                }
              }
              if (input.action === "clear") {
                if ((session.goal ?? "") !== "") yield* publish(context.sessionID, "")
                return { active: false, goal: "", message: "Session goal cleared." }
              }
              const objective = (input.objective ?? "").trim()
              if (objective === "")
                return yield* new ToolFailure({ message: "goal set requires a non-empty objective." })
              const goal =
                input.done_when === undefined || input.done_when.trim() === ""
                  ? objective
                  : `${objective}\nDone when: ${input.done_when.trim()}`
              if (session.goal !== goal) yield* publish(context.sessionID, goal)
              return { active: true, goal, message: `Session goal set:\n${goal}` }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/goal",
  layer,
  deps: [ToolRegistry.node, EventV2.node, SessionStore.node],
})
