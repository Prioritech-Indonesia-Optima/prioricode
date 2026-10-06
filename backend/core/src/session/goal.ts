/**
 * The durable session goal as a Context Source. While set, it is re-anchored
 * into every baseline system context (including after compaction), so the
 * agent cannot lose the objective by running out of conversational memory.
 * Absent goals contribute no source; clearing one emits its removal text at
 * the next Safe Provider-Turn Boundary.
 */
export * as SessionGoal from "./goal"

import { Effect, Schema } from "effect"
import { SystemContext } from "../system-context/index"

export const key = SystemContext.Key.make("session/goal")

export const render = (goal: string) =>
  [
    "The user has set a durable goal for this session. Treat it as the standing definition of success for every turn:",
    goal,
  ].join("\n")

export const context = (goal: string | undefined): SystemContext.SystemContext =>
  goal === undefined || goal === ""
    ? SystemContext.empty
    : SystemContext.make({
        key,
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed(goal),
        baseline: render,
        update: (_previous, goal) => `The session goal is now:\n${goal}`,
        removed: () => "The session goal that was previously set no longer applies.",
      })
