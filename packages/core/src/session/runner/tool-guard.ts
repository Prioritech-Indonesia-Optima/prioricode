export * as ToolGuard from "./tool-guard"

import { ConfigLoop } from "../../config/loop"
import { Hash } from "../../util/hash"

export interface Settings {
  readonly toolCallsPerTurn: number
  readonly toolOutputBytesPerTurn: number
  readonly repeatWarn: number
  readonly repeatBlock: number
  readonly readOnlyRepeatBlock: number
  readonly readOnlyTools: ReadonlySet<string>
}

export const DEFAULT_READ_ONLY_TOOLS = ["read", "glob", "grep", "webfetch", "skill"] as const

export const DEFAULT_SETTINGS: Settings = {
  toolCallsPerTurn: 64,
  toolOutputBytesPerTurn: 200_000,
  repeatWarn: 2,
  repeatBlock: 4,
  readOnlyRepeatBlock: 8,
  readOnlyTools: new Set<string>(DEFAULT_READ_ONLY_TOOLS),
}

export const settings = (info: ConfigLoop.Info | undefined): Settings => ({
  toolCallsPerTurn: info?.tool_calls_per_turn ?? DEFAULT_SETTINGS.toolCallsPerTurn,
  toolOutputBytesPerTurn: info?.tool_output_bytes_per_turn ?? DEFAULT_SETTINGS.toolOutputBytesPerTurn,
  repeatWarn: info?.repeat_warn ?? DEFAULT_SETTINGS.repeatWarn,
  repeatBlock: info?.repeat_block ?? DEFAULT_SETTINGS.repeatBlock,
  readOnlyRepeatBlock: info?.read_only_repeat_block ?? DEFAULT_SETTINGS.readOnlyRepeatBlock,
  readOnlyTools: info?.read_only_tools ? new Set(info.read_only_tools) : DEFAULT_SETTINGS.readOnlyTools,
})

export type Verdict =
  | { readonly type: "allow" }
  | { readonly type: "warn"; readonly warning: string }
  | { readonly type: "block"; readonly reason: string }

export interface Guard {
  /** Resets per-turn call and output counters. Identical-call history intentionally survives. */
  readonly beginTurn: () => void
  /** Inspects one locally executed tool call before it runs. Blocked calls must not execute. */
  readonly verdict: (name: string, input: unknown) => Verdict
  /** Accounts one settled call's approximate model-facing output size in bytes. */
  readonly recordOutput: (bytes: number) => void
}

const canonicalize = (value: unknown, stack: WeakSet<object>): string => {
  if (value === null) return "null"
  switch (typeof value) {
    case "number":
      return Number.isFinite(value) ? String(value) : "null"
    case "bigint":
    case "boolean":
      return String(value)
    case "string":
      return JSON.stringify(value)
    case "undefined":
    case "function":
    case "symbol":
      return "null"
  }
  if (stack.has(value)) return '"[circular]"'
  stack.add(value)
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item, stack)).join(",")}]`
    const entries = Object.entries(value)
      .map(([key, item]) => [key, canonicalize(item, stack)] as const)
      .sort((left, right) => (left[0] === right[0] ? 0 : left[0] < right[0] ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${item}`)
    return `{${entries.join(",")}}`
  } finally {
    stack.delete(value)
  }
}

export const callKey = (name: string, input: unknown) =>
  Hash.sha256(`${name}\u0000${canonicalize(input, new WeakSet())}`)

const toolCallCapMessage = (limit: number) =>
  `TOOL CALL LIMIT REACHED FOR THIS STEP (${limit} calls)

This provider turn already used its maximum of ${limit} local tool calls. Do NOT call any more tools in this turn. Respond with text: summarize what you learned, then continue next turn with a smaller, more targeted set of calls.`

const outputBudgetMessage = (budget: number) =>
  `TOOL OUTPUT BUDGET EXHAUSTED FOR THIS STEP (${budget} bytes)

Tool results collected in this provider turn already fill its aggregate output budget. Do NOT call any more tools in this turn. Work from what you already have, narrow later queries (offset/limit, include filters, targeted paths), or respond with a summary.`

const repeatWarnMessage = (name: string, count: number) =>
  `WARNING: identical call repeated (${count}x this run)

\`${name}\` was already called with exactly these arguments ${count} times. A repeated identical call normally returns a repeated identical result. Change something concrete (arguments, tool, approach) before calling again; further identical calls will be blocked.`

const repeatBlockMessage = (name: string, count: number) =>
  `TOOL CALL BLOCKED: identical call repeated ${count}x this run

\`${name}\` with exactly these arguments will not be executed again. Repetition is a loop, not progress. Stop and reflect:
1. Re-check the goal against the evidence already present in previous results.
2. Change something concrete: different arguments, a different tool, or new information.
3. If the underlying operation keeps failing, stop retrying and report the blocker and findings in text instead.`

export const make = (resolved: Settings): Guard => {
  const seen = new Map<string, number>()
  const warned = new Set<string>()
  let callsInTurn = 0
  let outputBytesInTurn = 0

  return {
    beginTurn: () => {
      callsInTurn = 0
      outputBytesInTurn = 0
    },
    verdict: (name, input) => {
      if (callsInTurn >= resolved.toolCallsPerTurn)
        return { type: "block", reason: toolCallCapMessage(resolved.toolCallsPerTurn) }
      if (outputBytesInTurn >= resolved.toolOutputBytesPerTurn)
        return { type: "block", reason: outputBudgetMessage(resolved.toolOutputBytesPerTurn) }
      const key = callKey(name, input)
      const count = (seen.get(key) ?? 0) + 1
      const blockThreshold = resolved.readOnlyTools.has(name)
        ? resolved.readOnlyRepeatBlock
        : resolved.repeatBlock
      if (count >= blockThreshold) return { type: "block", reason: repeatBlockMessage(name, count) }
      seen.set(key, count)
      callsInTurn += 1
      if (count >= resolved.repeatWarn && !warned.has(key)) {
        warned.add(key)
        return { type: "warn", warning: repeatWarnMessage(name, count) }
      }
      return { type: "allow" }
    },
    recordOutput: (bytes) => {
      outputBytesInTurn += Math.max(0, bytes)
    },
  }
}
