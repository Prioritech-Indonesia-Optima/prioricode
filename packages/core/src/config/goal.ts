export * as ConfigGoal from "./goal"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

/**
 * Finish-gate verification of the durable session goal. `command` mode runs a
 * shell check whose exit code 0 means the goal is met; `llm` mode asks the
 * session model once per finish attempt for a DONE/NOT_DONE verdict against
 * the transcript. Either verdict of "met" clears the goal automatically.
 * Everything fails OPEN: judge errors, timeouts, and unparsable answers let
 * the drain finish rather than trapping the user.
 */
export class Info extends Schema.Class<Info>("ConfigV2.Goal")({
  check: Schema.Literals(["command", "llm", "off"]).pipe(Schema.optional).annotate({
    description: 'Verification mode; defaults to "command" when a command is set, otherwise "llm"',
  }),
  command: Schema.String.pipe(Schema.optional).annotate({
    description: "Shell command for command mode; exit 0 marks the goal met and clears it",
  }),
  max_attempts: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum finish-gate continuations per drain (default 2, then fail open)",
  }),
  timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Command mode timeout in seconds (default 120)",
  }),
}) {}
