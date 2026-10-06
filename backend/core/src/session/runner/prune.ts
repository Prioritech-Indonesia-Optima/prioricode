/**
 * Pressure-gated context pruning. The durable session history is never
 * rewritten; this is a pure projection applied when a provider request is
 * assembled, so replay, compaction, and the transcript keep the full bytes.
 *
 * Contract:
 * - below pressure (or without a known context limit) the input array is
 *   returned verbatim: no-pressure requests stay byte-identical
 * - only large completed LOCAL tool results are elided; user text, assistant
 *   text/reasoning, tool-call inputs, and provider-executed results (whose
 *   exact payloads some providers require round-tripped) are never touched
 * - the most recent `keepRecentSteps` assistant steps keep full output
 * - replacement is deterministic and monotone: a pruned result stays pruned
 *   (the elided count never shrinks as the conversation only grows forward)
 */
export * as SessionPrune from "./prune"

import { Message, type ContentPart } from "@prioricode/llm"

export interface Options {
  readonly pressure: boolean
  readonly keepRecentSteps: number
  readonly minBytes: number
}

const serialBytes = (value: unknown) => {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8")
  } catch {
    return 0
  }
}

const placeholder = (elided: number) => `[tool output pruned — ${elided} bytes elided]`
const placeholderBytes = serialBytes({ type: "text", value: placeholder(0) })

const prunePart = (part: ContentPart, options: Options): ContentPart => {
  if (part.type !== "tool-result") return part
  const result = part
  if (result.providerExecuted === true) return result
  const size = serialBytes(result.result)
  if (size < options.minBytes) return result
  return {
    ...result,
    result: { type: "text", value: placeholder(Math.max(0, size - placeholderBytes)) },
  } satisfies ContentPart
}

export const projectForRequest = (messages: readonly Message[], options: Options): readonly Message[] => {
  if (!options.pressure || options.keepRecentSteps < 0) return messages
  // A step is one assistant turn plus the tool results that follow it before
  // the next assistant. Assign every message to the current step, then protect
  // the trailing keepRecentSteps steps so the model still sees live output.
  let step = -1
  let largest = 0
  const stepOf: number[] = []
  for (const message of messages) {
    if (message.role === "assistant") {
      step += 1
      largest = step
    }
    stepOf.push(Math.max(step, 0))
  }
  if (step < 0) return messages as readonly Message[]
  const protectedFrom = largest - options.keepRecentSteps + 1
  let changed = false
  const projected = messages.map((message, index) => {
    if (stepOf[index]! >= protectedFrom) return message
    if (message.role === "tool" || message.role === "assistant") {
      const content = message.content.map((part) => prunePart(part, options))
      if (content.some((part, partIndex) => part !== message.content[partIndex])) {
        changed = true
        return Message.make({ id: message.id, role: message.role, content, metadata: message.metadata })
      }
    }
    return message
  })
  return changed ? projected : (messages as readonly Message[])
}
