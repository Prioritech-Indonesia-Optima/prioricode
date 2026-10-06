import { PermissionV1 } from "@prioricode/core/v1/permission"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent's deny rules and external_directory rules. The caller merges
 *    the parent AGENT's ruleset with the parent SESSION's ruleset first, so
 *    plan-mode edit denies govern subagents too: a subagent must never be
 *    able to do what its parent session's posture forbids. Allows are not
 *    inherited — the subagent's own agent config still determines its
 *    capabilities beyond that boundary.
 * 2. Default `todowrite`, `task`, and `sessions` denies if the subagent's own
 *    ruleset doesn't already permit them. Subagents are spawned for isolated
 *    units of work and must not cross-talk with unrelated sibling sessions.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  const canSessions = input.subagent.permission.some((rule) => rule.permission === "sessions")
  return [
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canSessions ? [] : [{ permission: "sessions" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}
