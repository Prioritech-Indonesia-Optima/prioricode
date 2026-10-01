export * as PermissionFailure from "./permission-failure"

import { PermissionV2 } from "../permission"
import type { SessionV2 } from "../session"
import { Tool } from "./tool"

/**
 * Standardized model-facing translation of `PermissionV2.assert` failures.
 *
 * Leaves route permission errors through this before their generic domain
 * `Tool.failure` catch so the user's correction feedback and the blocking rule
 * text survive into the model's only self-correction channel. Bare declines
 * are `PermissionV2.DeclinedError` defects by design and never reach here.
 */
const ruleText = (rules: ReadonlyArray<{ readonly action: string; readonly resource: string; readonly effect: string }>) =>
  rules.length === 0
    ? "the active permission policy"
    : rules.map((rule) => `${rule.action} ${rule.resource} (${rule.effect})`).join(", ")

export const fromError = (error: PermissionV2.Error | SessionV2.NotFoundError) =>
  error instanceof PermissionV2.CorrectedError
    ? Tool.failure(
        `The user rejected this action with feedback: "${error.feedback}". Address the feedback before retrying or choosing another approach.`,
      )
    : error instanceof PermissionV2.BlockedError
      ? Tool.failure(
          `Blocked by permission rules: ${ruleText(error.rules)}. Do not retry this action; explain or ask the user instead.`,
        )
      : Tool.failure(`Session ${error.sessionID} no longer exists; the permission check could not apply.`)
