/**
 * Shipped built-in slash commands. Pure composition of existing engine
 * surfaces: /spec chains the question tool (interview), the write tool
 * (SPEC.md), and the goal tool (durable objective). No new engine capability
 * is introduced; the command is just a governed prompt template that the
 * client expands into the next user turn.
 */
export * as CommandBuiltIns from "./builtins"

import { Effect, Layer } from "effect"
import { CommandV2 } from "../command"
import { makeLocationNode } from "../effect/app-node"

const SPEC_TEMPLATE = `You are running the /spec command. Produce a written implementation spec through a short structured interview, then register it as this session's durable goal. Follow the steps in order and do nothing else.

1. INTERVIEW. Use the question tool to ask the user at most four focused questions, batched in one call when possible. Cover: (a) the objective and what success looks like, (b) scope — what is explicitly included and excluded, (c) constraints — files, APIs, performance, compatibility, or patterns to follow or avoid, (d) verification — the exact tests, commands, or observable checks that prove the work is done. Prefer multiple-choice options with a free-text escape hatch; skip any dimension the user's request already answers unambiguously.

2. WRITE THE SPEC. Consolidate the answers into a single markdown file at SPEC.md in the repository root (or a path the user specified): sections Objective, Scope (in/out), Constraints, Verification, and a final one-line "Done when" acceptance sentence. Keep it under 120 lines; concrete and checkable, no filler. Use the write tool.

3. REGISTER THE GOAL. Call the goal tool with action "set": objective = the spec's Objective sentence, done_when = the Verification/"Done when" sentence. This anchors the goal in every future turn and enables the finish gate.

4. PRESENT. Reply with a two-line summary: where the spec was written and that the goal is set. Do not start implementing; wait for the user's next instruction.`

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const commands = yield* CommandV2.Service
    yield* commands.transform((draft) => {
      draft.update("spec", (command) => {
        command.template = SPEC_TEMPLATE
        command.description = "Structured interview, write SPEC.md, and set it as the durable session goal"
      })
    })
  }),
)

export const node = makeLocationNode({ name: "command-builtins", layer, deps: [CommandV2.node] })
