import type { AssistantMessage, Message, Part, Provider, Session, ToolPart } from "@prioricode/sdk/v2"
import { Locale } from "./locale"

export const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export type SessionUsage = {
  tokens: number
  percent?: number
  context: string
  cost?: string
}

// Context/cost for a session from the last completed assistant message with
// recorded output tokens (the compaction-relevant number). Kept pure so the
// status bar, prompt meta row, and tests share one implementation.
export function computeUsage(input: {
  session: Session | undefined
  messages: Message[]
  providers: Provider[]
}): SessionUsage | undefined {
  const last = input.messages.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
  if (!last) return

  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  if (tokens <= 0) return

  const model = input.providers.find((item) => item.id === last.providerID)?.models[last.modelID]
  const percent = model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : undefined
  const cost = input.session?.cost ?? 0
  return {
    tokens,
    percent,
    context: percent !== undefined ? `${Locale.number(tokens)} (${percent}%)` : Locale.number(tokens),
    cost: cost > 0 ? money.format(cost) : undefined,
  }
}

// Rough live output-token estimate for the in-flight assistant message from
// delta-appended text/reasoning parts (~4 chars/token). Quantized to 100s so
// bound text nodes rarely change value between stream chunks (no reflow
// jitter); displayed with a `~` prefix and never merged into computeUsage().
export function estimateStreamingTokens(parts: Part[]): number {
  let chars = 0
  for (const part of parts) {
    if (part.type === "text" && !part.synthetic && !part.ignored) chars += part.text.length
    else if (part.type === "reasoning") chars += part.text.length
  }
  return Math.round(chars / 4 / 100) * 100
}

export type RunningTool = {
  tool: string
  title?: string
}

export function runningTool(parts: Part[]): RunningTool | undefined {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  const running = tools.findLast((part) => part.state.status === "running")
  if (!running || running.state.status !== "running") return
  return { tool: running.tool, title: running.state.title }
}

export function completedToolCount(parts: Part[]): number {
  return parts.filter((part): part is ToolPart => part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")).length
}

// One-line live turn summary: current activity, finished tool count, elapsed
// wall time, and a rough streamed-token estimate.
export function formatTurnHud(input: { tool?: RunningTool; done: number; estimate: number; elapsedMs: number }): string {
  return [
    input.tool ? (input.tool.title ?? Locale.titlecase(input.tool.tool)) : undefined,
    input.done > 0 ? `${input.done} tools` : undefined,
    Locale.duration(input.elapsedMs),
    input.estimate > 0 ? `~${Locale.number(input.estimate)} tok` : undefined,
  ]
    .filter(Boolean)
    .join(" · ")
}
