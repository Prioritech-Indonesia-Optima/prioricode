export * as SessionCompaction from "./compaction"

import { LLM, LLMError, LLMEvent, Message, type LLMRequest, type Model } from "@prioricode/llm"
import { DateTime, Effect, Stream } from "effect"
import type { Config } from "../config"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { Token } from "../util/token"

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 8_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_OUTPUT_TOKENS = 4_096
// The <conversation-checkpoint> wrapper rendered around summary + recent in the
// post-compaction request; reserved when capping the verbatim tail to the window.
const CHECKPOINT_OVERHEAD = 64
// Headroom kept inside the summary-request budget for the optional instructions
// line and estimation rounding.
const PROMPT_MARGIN = 256
const TRUNCATION_MARKER = "[truncated to fit the model window]"
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`
const SUMMARY_UPDATE_INSTRUCTIONS = `The <prior-summary> summarizes everything that happened before the <conversation>. Construct a new summary that combines both. The <prior-summary> is discarded after this: anything you do not carry into the new summary is lost.

When combining:
- Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from the <prior-summary> even when the <conversation> does not mention them. Drop only what is finished and no longer needed.
- The <conversation> is more recent than the <prior-summary>. Where they conflict, the conversation wins: state the corrected fact and drop the old claim.
- Add new progress, decisions, constraints, and context from the conversation.
- Move completed work from "Active" to "Completed".
- If a blocker has been resolved, update the summary to reflect that while keeping any details still needed to continue the work.
- Update "Objective" and "Next Move" to reflect the current work state.`

export type Entry = {
  readonly seq: number
  readonly message: SessionMessage.Message
}

export type Settings = {
  readonly auto: boolean
  readonly buffer: number
  readonly tokens: number
  readonly turns: number | undefined
  readonly threshold: number | undefined
  readonly defaultContext: number
}

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly config: readonly Config.Entry[]
}

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly entries: readonly Entry[]
  readonly model: Model
  readonly request?: LLMRequest
  readonly reason?: "auto" | "manual" | "overflow"
  readonly headCutSeq?: number
  readonly instructions?: string
}

export type ContextResolution = {
  readonly context: number
  readonly source: "model" | "default"
  readonly declared: number | undefined
}

/** The effective window is always a function of the selected model; the config fallback is recorded as such. */
export const resolveContext = (model: Model, defaultContext: number): ContextResolution => {
  const declared = model.route.defaults.limits?.context
  if (declared !== undefined && declared > 0) return { context: declared, source: "model", declared }
  return { context: defaultContext, source: "default", declared }
}

type ConversationItem = {
  readonly seq: number
  readonly text: string
  readonly user: boolean
}

export type CompactionPlan = {
  readonly head: string
  readonly recent: string
  readonly priorRecent: string
  readonly priorSummary: string | undefined
  readonly droppedTokens: number
  readonly truncatedPriorRecent: boolean
  readonly hardTruncated: boolean
  readonly headTokens: number
  readonly recentTokens: number
  readonly fallback: "none" | "progressive" | "hard-truncation"
}

export type PlanResult = CompactionPlan | { readonly fallback: "window-too-small" }

export type CompactionDecision = {
  readonly trigger: "threshold" | "budget" | "overflow" | "manual"
  readonly context: number
  readonly context_source: "model" | "default"
  readonly estimated: number
  readonly limit: number
  readonly fallback: "none" | "progressive" | "hard-truncation" | "window-too-small"
}

const estimate = (value: unknown) => Token.estimate(JSON.stringify(value))

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

export const serializeToolContent = (content: SessionMessage.ToolStateCompleted["content"]) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

export const serialize = (message: SessionMessage.Message) => {
  if (message.type === "user") {
    const files = message.files?.map((file) => `[Attached ${file.mime}: ${file.name ?? file.uri}]`) ?? []
    return [`[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        if (part.state.status === "completed")
          return [
            `[Assistant tool call]: ${part.name}(${input})`,
            `[Tool result]: ${truncate(serializeToolContent(part.state.content))}`,
          ]
        if (part.state.status === "error")
          return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool error]: ${part.state.error.message}`]
        return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool result]: [Tool execution interrupted]`]
      })
      .join("\n")
  }
  if (message.type === "system") return `[System update]: ${message.text}`
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "shell") return `[Shell]: ${message.command}\n${truncate(message.output)}`
  return ""
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.compaction ? [entry.info.compaction] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      auto: current.auto ?? result.auto,
      buffer: current.buffer ?? result.buffer,
      tokens: current.keep?.tokens ?? result.tokens,
      turns: current.keep?.turns ?? result.turns,
      threshold: current.threshold ?? result.threshold,
      defaultContext: current.default_context ?? result.defaultContext,
    }),
    { auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS, turns: undefined, threshold: undefined, defaultContext: 128_000 },
  )
}

const truncateTail = (text: string, keepChars: number) =>
  keepChars <= 0 ? "" : `${TRUNCATION_MARKER}\n${text.slice(-keepChars)}`

/**
 * Pure, terminating fit-or-shrink planner. The summary prompt (prior recent +
 * head + prior summary) must fit `context - summaryOutput`; the verbatim tail
 * must fit the window so the post-compaction request can. Reduction priority:
 * drop oldest head (counted) → truncate prior recent (25%/step) → hard-truncate
 * the prior summary → hard-truncate the tail. Always returns a fitting plan or
 * an explainable `window-too-small`.
 */
export const plan = (
  entries: readonly Entry[],
  settings: Settings,
  priorSummary: string | undefined,
  priorRecent: string,
  context: number,
  summaryOutput: number,
  headCutSeq?: number,
): PlanResult | undefined => {
  const conversation: ConversationItem[] = entries
    .filter((entry) => entry.message.type !== "compaction")
    .map((entry) => ({ seq: entry.seq, text: serialize(entry.message), user: entry.message.type === "user" }))
    .filter((item) => item.text !== "")
  if (conversation.length === 0) return undefined

  let head: ConversationItem[]
  let recent: ConversationItem[]
  if (headCutSeq !== undefined) {
    // Summarize everything up to and including the anchor, then clamp so at
    // least one trailing message is retained verbatim. Idle-only callers
    // guarantee no unsettled tool call straddles the boundary.
    let split = conversation.findIndex((item) => item.seq > headCutSeq)
    if (split === -1) split = conversation.length
    split = Math.min(split, Math.max(conversation.length - 1, 1))
    head = conversation.slice(0, split)
    recent = conversation.slice(split)
  } else {
    recent = []
    let recentTokens = 0
    let turns = 0
    for (let index = conversation.length - 1; index >= 0; index--) {
      const item = conversation[index]
      if (recent.length >= 1) {
        if (recentTokens + Token.estimate(item.text) > settings.tokens) break
        if (settings.turns !== undefined && item.user && turns >= settings.turns) break
      }
      recent.unshift(item)
      recentTokens += Token.estimate(item.text)
      if (item.user) turns++
    }
    // The turn cap breaks at a user message, leaving the earlier turn's
    // assistant messages at the front; trim them so the tail is whole turns.
    if (settings.turns !== undefined) while (recent.length > 0 && !recent[0].user) recent.shift()
    head = conversation.slice(0, conversation.length - recent.length)
  }

  let hardTruncated = false
  // The checkpoint (summary + recent) must fit the window; cap the tail so an
  // oversized message is truncated instead of stalling the session. Oldest
  // items are reduced to the marker first; the newest keeps its tail.
  const recentCap = Math.min(settings.tokens, Math.max(0, context - summaryOutput - CHECKPOINT_OVERHEAD))
  if (recentCap > 0) {
    let total = recent.reduce((sum, item) => sum + Token.estimate(item.text), 0)
    for (let index = 0; index < recent.length - 1 && total > recentCap; index++) {
      const item = recent[index]
      total = total - Token.estimate(item.text) + Token.estimate(TRUNCATION_MARKER)
      recent[index] = { ...item, text: TRUNCATION_MARKER }
      hardTruncated = true
    }
    const newest = recent[recent.length - 1]
    if (total > recentCap) {
      const keepChars = Math.max(0, newest.text.length - (total - recentCap) * 4 - 64)
      total = total - Token.estimate(newest.text) + Token.estimate(truncateTail(newest.text, keepChars))
      recent[recent.length - 1] = { ...newest, text: truncateTail(newest.text, keepChars) }
      hardTruncated = true
    }
  }

  let summary = priorSummary
  let droppedTokens = 0
  let truncatedPriorRecent = false
  let headText = head.map((item) => item.text).join("\n\n")
  // Margin covers the optional instructions line and estimation rounding.
  const budget = context - summaryOutput - PROMPT_MARGIN
  if (budget <= 0) return { fallback: "window-too-small" }
  const build = () =>
    buildPrompt({
      previousSummary: summary,
      context: [priorRecent, headText].filter(Boolean),
      instructions: undefined,
    })
  for (;;) {
    const prompt = build()
    if (Token.estimate(prompt) <= budget) break
    if (head.length > 0) {
      const oldest = head.shift()!
      droppedTokens += Token.estimate(oldest.text)
      headText = head.map((item) => item.text).join("\n\n")
      continue
    }
    if (priorRecent.length > 0) {
      priorRecent = priorRecent.slice(Math.ceil(priorRecent.length * 0.25))
      truncatedPriorRecent = true
      continue
    }
    if (summary !== undefined) {
      const overflow = Token.estimate(prompt) - budget
      summary = truncateTail(summary, summary.length - overflow * 4 - 64)
      hardTruncated = true
      continue
    }
    return { fallback: "window-too-small" }
  }

  const recentText = recent.map((item) => item.text).join("\n\n")
  const fallback = hardTruncated
    ? "hard-truncation"
    : droppedTokens > 0 || truncatedPriorRecent
      ? "progressive"
      : "none"
  return {
    head: headText,
    recent: recentText,
    priorRecent,
    priorSummary: summary,
    droppedTokens,
    truncatedPriorRecent,
    hardTruncated,
    headTokens: Token.estimate(headText),
    recentTokens: Token.estimate(recentText),
    fallback,
  }
}

export const buildPrompt = (input: {
  readonly previousSummary?: string
  readonly context: readonly string[]
  readonly instructions?: string
}) => {
  const conversation = `Here is the conversation so far:\n\n<conversation>\n${input.context.join("\n\n")}\n</conversation>`
  const focus =
    input.instructions === undefined || input.instructions.trim() === ""
      ? []
      : [`The user asked this summary to specifically preserve: ${input.instructions.trim()}`]
  if (!input.previousSummary)
    return [
      conversation,
      ...focus,
      "Create a new anchored summary from the conversation history in the <conversation> tags above so another coding agent can continue the work.",
      SUMMARY_TEMPLATE,
    ].join("\n\n")
  return [
    conversation,
    ...focus,
    `Here is the summary of the conversation before the <conversation> above:\n\n<prior-summary>\n${input.previousSummary}\n</prior-summary>`,
    SUMMARY_UPDATE_INSTRUCTIONS,
    SUMMARY_TEMPLATE,
  ].join("\n\n")
}

export const make = (dependencies: Dependencies) => {
  const config = settings(dependencies.config)
  const decide = (input: Input, resolution: ContextResolution, planned: PlanResult, output: number): CompactionDecision => {
    const trigger =
      input.reason === "manual"
        ? "manual"
        : input.reason === "overflow"
          ? "overflow"
          : config.threshold !== undefined
            ? "threshold"
            : "budget"
    const limit = Math.max(
      0,
      config.threshold !== undefined
        ? Math.floor((resolution.context * Math.min(config.threshold, 100)) / 100)
        : resolution.context - Math.max(output, config.buffer),
    )
    const estimated =
      input.request !== undefined
        ? estimate({ system: input.request.system, messages: input.request.messages, tools: input.request.tools })
        : estimate({ system: [], messages: input.entries.map((entry) => serialize(entry.message)), tools: [] })
    return {
      trigger,
      context: resolution.context,
      context_source: resolution.source,
      estimated,
      limit,
      fallback: planned.fallback,
    }
  }
  const compact = Effect.fn("SessionCompaction.compact")(function* (input: Input) {
    const reason = input.reason ?? "auto"
    const resolution = resolveContext(input.model, config.defaultContext)
    if (resolution.context <= 0) {
      yield* Effect.log("compaction skipped: no usable context window", {
        sessionID: input.sessionID,
        reason,
        context: resolution.context,
        source: resolution.source,
      })
      return false
    }
    const output = input.request?.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    const summaryOutput = Math.min(output || SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS)
    const prior = input.entries.find((entry) => entry.message.type === "compaction")?.message
    const planned = plan(
      input.entries,
      config,
      prior?.type === "compaction" ? prior.summary : undefined,
      prior?.type === "compaction" ? prior.recent : "",
      resolution.context,
      summaryOutput,
      input.headCutSeq,
    )
    if (planned === undefined) return false
    if (planned.fallback === "window-too-small") {
      yield* Effect.log("compaction unavailable: model window too small to hold a summary", {
        sessionID: input.sessionID,
        reason,
        context: resolution.context,
        summaryOutput,
      })
      return false
    }
    const decision = decide(input, resolution, planned, output)
    const messageID = SessionMessage.ID.create()
    yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason,
      decision,
    })

    const chunks: string[] = []
    let failed = false
    const summarized = yield* dependencies.llm
      .stream(
        LLM.request({
          model: input.model,
          http: input.request?.http,
          messages: [
            Message.user(
              buildPrompt({
                previousSummary: planned.priorSummary,
                context: [planned.priorRecent, planned.head].filter(Boolean),
                instructions: input.instructions,
              }),
            ),
          ],
          tools: [],
          generation: { maxTokens: summaryOutput },
        }),
      )
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (LLMEvent.is.providerError(event)) failed = true
            if (LLMEvent.is.textDelta(event)) {
              chunks.push(event.text)
              yield* dependencies.events.publish(SessionEvent.Compaction.Delta, {
                sessionID: input.sessionID,
                messageID,
                timestamp: yield* DateTime.now,
                text: event.text,
              })
            }
          }),
        ),
        Effect.as(true),
        Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
      )
    const summary = chunks.join("")
    if (!summarized || failed || !summary.trim()) {
      yield* Effect.log("compaction failed: summary request failed", { sessionID: input.sessionID, reason })
      return false
    }
    yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason,
      text: summary,
      recent: planned.recent,
      outcome: planned.hardTruncated ? "hard-truncated" : "summarized",
      dropped_tokens: planned.droppedTokens > 0 ? planned.droppedTokens : undefined,
    })
    yield* Effect.log("compaction completed", {
      sessionID: input.sessionID,
      reason,
      outcome: planned.hardTruncated ? "hard-truncated" : "summarized",
      fallback: planned.fallback,
      dropped_tokens: planned.droppedTokens,
      head_tokens: planned.headTokens,
      recent_tokens: planned.recentTokens,
    })
    return true
  })
  const compactAfterOverflow = (input: Input) => compact({ ...input, reason: "overflow" })
  const compactManual = (input: Input) => compact({ ...input, reason: "manual" })
  const compactIfNeeded = Effect.fn("SessionCompaction.compactIfNeeded")(function* (
    input: Input & { readonly request: LLMRequest },
  ) {
    if (!config.auto) return false
    const resolution = resolveContext(input.model, config.defaultContext)
    if (resolution.context <= 0) return false
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    const estimated = estimate({
      system: input.request.system,
      messages: input.request.messages,
      tools: input.request.tools,
    })
    const limit =
      config.threshold !== undefined
        ? Math.floor((resolution.context * Math.min(config.threshold, 100)) / 100)
        : resolution.context - Math.max(output, config.buffer)
    if (estimated <= limit) return false
    if (limit <= 0) {
      yield* Effect.log("compaction skipped: model window cannot fit output plus reserved buffer", {
        sessionID: input.sessionID,
        context: resolution.context,
        source: resolution.source,
        output,
        buffer: config.buffer,
        threshold: config.threshold,
      })
      return false
    }
    yield* Effect.log("compaction triggered", {
      sessionID: input.sessionID,
      trigger: config.threshold !== undefined ? "threshold" : "budget",
      context: resolution.context,
      context_source: resolution.source,
      estimated,
      limit,
    })
    return yield* compact({ ...input, reason: "auto" })
  })
  const contextLimit = (model: Model) => resolveContext(model, config.defaultContext).context
  return {
    compactIfNeeded,
    compactAfterOverflow,
    compactManual,
    contextLimit,
  }
}
