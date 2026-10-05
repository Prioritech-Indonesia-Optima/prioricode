import type { RawEvent } from "../events/normalize"

export interface AttachmentMeta {
  name?: string
  mime: string
  image: boolean
}

export interface UserBlock {
  kind: "user"
  id: string
  text: string
  files: AttachmentMeta[]
}

export interface TextPart {
  type: "text"
  textID: string
  text: string
  streaming: boolean
}

export interface ReasoningPart {
  type: "reasoning"
  reasoningID: string
  text: string
  streaming: boolean
}

export interface ToolPart {
  type: "tool"
  callID: string
  name: string
  state: "running" | "success" | "error"
  input?: string
  summary?: string
  progress?: string
  error?: string
}

export interface ShellPart {
  type: "shell"
  callID: string
  command: string
  state: "running" | "done"
  output?: string
}

export type AssistantPart = TextPart | ReasoningPart | ToolPart | ShellPart

export interface TokenSummary {
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface AssistantBlock {
  kind: "assistant"
  id: string
  agent?: string
  model?: string
  status: "running" | "done" | "error"
  retryNote?: string
  error?: string
  cost?: number
  tokens?: TokenSummary
  files?: string[]
  parts: AssistantPart[]
}

export interface SystemBlock {
  kind: "system"
  id: string
  text: string
  tone: "info" | "error"
}

export interface CompactionBlock {
  kind: "compaction"
  id: string
  state: "running" | "done"
  reason?: "auto" | "manual"
  text?: string
  recent?: string
}

export interface RevertBlock {
  kind: "revert"
  id: string
  state: "staged" | "committed"
  messageID: string
  files?: string[]
}

export interface PermissionBlock {
  kind: "permission"
  id: string
  action: string
  resources: string[]
  resolved?: "once" | "always" | "reject"
}

export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionItem {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionBlock {
  kind: "question"
  id: string
  questions: QuestionItem[]
  resolved?: "answered" | "rejected"
}

export type TranscriptBlock =
  | UserBlock
  | AssistantBlock
  | SystemBlock
  | CompactionBlock
  | RevertBlock
  | PermissionBlock
  | QuestionBlock

export interface TranscriptState {
  blocks: TranscriptBlock[]
  busy: boolean
  lastSeq: number
}

export function emptyTranscript(): TranscriptState {
  return { blocks: [], busy: false, lastSeq: 0 }
}

export interface FoldResult {
  state: TranscriptState
  changed: ReadonlySet<string>
  changedBusy: boolean
}

export type PermissionReply = "once" | "always" | "reject"

export interface OutgoingAttachment {
  name: string
  mime: string
  dataBase64: string
}

const truncate = (value: string, max: number) => (value.length > max ? value.slice(0, max) + "…" : value)

const asRecord = (value: unknown): Record<string, any> =>
  typeof value === "object" && value !== null ? (value as Record<string, any>) : {}

const errText = (error: unknown): string => {
  const record = asRecord(error)
  if (typeof record.message === "string") return record.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error) ?? "Unknown error"
  } catch {
    return "Unknown error"
  }
}

const guessMime = (uri: string): string => {
  const data = /^data:([^;,]+)/i.exec(uri)
  if (data) return data[1].toLowerCase()
  const ext = /\.([a-z0-9]+)$/i.exec(uri.split(/[?#]/)[0])?.[1]?.toLowerCase()
  switch (ext) {
    case "png":
      return "image/png"
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "gif":
      return "image/gif"
    case "webp":
      return "image/webp"
    default:
      return "application/octet-stream"
  }
}

const attachmentMeta = (file: unknown): AttachmentMeta => {
  const record = asRecord(file)
  const uri = typeof record.uri === "string" ? record.uri : ""
  const mime = typeof record.mime === "string" ? record.mime : guessMime(uri)
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    mime,
    image: mime.startsWith("image/"),
  }
}

const formatModel = (model: unknown): string | undefined => {
  const record = asRecord(model)
  if (typeof record.id === "string" && typeof record.providerID === "string") {
    return record.variant ? `${record.providerID}/${record.id} (${record.variant})` : `${record.providerID}/${record.id}`
  }
  if (typeof model === "string") return model
  return undefined
}

const textContent = (content: unknown): string | undefined => {
  if (!Array.isArray(content)) return undefined
  for (const item of content) {
    const record = asRecord(item)
    if (record.type === "text" && typeof record.text === "string") return record.text
  }
  return undefined
}

const clone = (state: TranscriptState): TranscriptState => ({ ...state, blocks: [...state.blocks] })

const indexOfBlock = (blocks: TranscriptBlock[], id: string | undefined): number =>
  id === undefined ? -1 : blocks.findIndex((block) => block.id === id)

const setBlock = (blocks: TranscriptBlock[], index: number, block: TranscriptBlock) => {
  if (index >= 0) blocks[index] = block
  else blocks.push(block)
}

const ensureAssistant = (state: TranscriptState, id: string): { next: TranscriptState; block: AssistantBlock } => {
  const next = clone(state)
  const index = indexOfBlock(next.blocks, id)
  if (index >= 0 && next.blocks[index].kind === "assistant") {
    return { next, block: next.blocks[index] as AssistantBlock }
  }
  const block: AssistantBlock = { kind: "assistant", id, status: "running", parts: [] }
  next.blocks.push(block)
  return { next, block }
}

const settledAssistant = (state: TranscriptState, id: string): AssistantBlock | undefined => {
  const block = state.blocks.find((candidate) => candidate.id === id)
  return block && block.kind === "assistant" ? block : undefined
}

const upsertPart = <P extends AssistantPart>(
  state: TranscriptState,
  assistantID: string,
  match: (part: AssistantPart) => part is P,
  create: () => P,
): { next: TranscriptState; part: P } => {
  const { next, block } = ensureAssistant(state, assistantID)
  const index = block.parts.findIndex((part) => match(part))
  if (index >= 0) {
    const part = { ...(block.parts[index] as P) }
    const updated = { ...block, parts: [...block.parts] }
    updated.parts[index] = part
    setBlock(next.blocks, indexOfBlock(next.blocks, block.id), updated)
    return { next, part }
  }
  const part = create()
  const updated = { ...block, parts: [...block.parts, part] }
  setBlock(next.blocks, indexOfBlock(next.blocks, block.id), updated)
  return { next, part }
}

const isTextPartWith = (textID: string) => (part: AssistantPart): part is TextPart => part.type === "text" && part.textID === textID
const isReasoningPartWith =
  (reasoningID: string) => (part: AssistantPart): part is ReasoningPart => part.type === "reasoning" && part.reasoningID === reasoningID
const isToolPartWith = (callID: string) => (part: AssistantPart): part is ToolPart => part.type === "tool" && part.callID === callID
const isShellPartWith = (callID: string) => (part: AssistantPart): part is ShellPart => part.type === "shell" && part.callID === callID

const applyText = (
  state: TranscriptState,
  assistantID: string,
  textID: string,
  mutate: (part: { text: string; streaming: boolean }) => void,
): TranscriptState => {
  const { next, part } = upsertPart(state, assistantID, isTextPartWith(textID), () => ({ type: "text", textID, text: "", streaming: true }))
  mutate(part)
  return next
}

const applyReasoning = (
  state: TranscriptState,
  assistantID: string,
  reasoningID: string,
  mutate: (part: { text: string; streaming: boolean }) => void,
): TranscriptState => {
  const { next, part } = upsertPart(state, assistantID, isReasoningPartWith(reasoningID), () => ({
    type: "reasoning",
    reasoningID,
    text: "",
    streaming: true,
  }))
  mutate(part)
  return next
}

const applyTool = (
  state: TranscriptState,
  assistantID: string,
  callID: string,
  mutate: (part: { state: "running" | "success" | "error"; name?: string; input?: string; summary?: string; progress?: string; error?: string }) => void,
  name?: string,
): TranscriptState => {
  const { next, part } = upsertPart(state, assistantID, isToolPartWith(callID), () => ({
    type: "tool",
    callID,
    name: name ?? "tool",
    state: "running",
  }))
  if (name !== undefined) part.name = name
  mutate(part)
  return next
}

const applyShell = (state: TranscriptState, messageID: string, callID: string, command: string): TranscriptState => {
  const { next, part } = upsertPart(state, messageID, isShellPartWith(callID), () => ({
    type: "shell",
    callID,
    command,
    state: "running",
  }))
  part.command = command
  return next
}

const finishShell = (state: TranscriptState, callID: string, output: string): TranscriptState => {
  for (let i = state.blocks.length - 1; i >= 0; i--) {
    const block = state.blocks[i]
    if (block.kind !== "assistant") continue
    const index = block.parts.findIndex((part) => part.type === "shell" && part.callID === callID)
    if (index < 0) continue
    const next = clone(state)
    const parts = [...block.parts]
    parts[index] = { ...(parts[index] as ShellPart), state: "done", output: truncate(output, 4000) }
    setBlock(next.blocks, i, { ...block, parts })
    return next
  }
  return state
}

const systemNote = (state: TranscriptState, id: string, text: string, tone: "info" | "error" = "info"): TranscriptState => {
  const next = clone(state)
  const index = indexOfBlock(next.blocks, id)
  if (index >= 0) return state
  next.blocks.push({ kind: "system", id, text, tone })
  return next
}

const upsertUser = (state: TranscriptState, id: string, text: string, files: AttachmentMeta[]): TranscriptState => {
  const next = clone(state)
  const index = indexOfBlock(next.blocks, id)
  const block: TranscriptBlock = { kind: "user", id, text, files }
  setBlock(next.blocks, index, block)
  return next
}

const applyPromptEvent = (state: TranscriptState, data: Record<string, any>): TranscriptState => {
  const messageID = typeof data.messageID === "string" ? data.messageID : undefined
  if (messageID === undefined) return state
  const prompt = asRecord(data.prompt)
  const existing = state.blocks.find((block) => block.id === messageID)
  if (existing && existing.kind === "user") return state
  const text = typeof prompt.text === "string" ? prompt.text : ""
  const files = Array.isArray(prompt.files) ? prompt.files.map(attachmentMeta) : []
  return upsertUser(state, messageID, text, files)
}

const applyPermissionAsked = (state: TranscriptState, data: Record<string, any>): TranscriptState => {
  const id = typeof data.id === "string" ? data.id : undefined
  if (id === undefined || indexOfBlock(state.blocks, id) >= 0) return state
  const next = clone(state)
  next.blocks.push({
    kind: "permission",
    id,
    action: typeof data.action === "string" ? data.action : "action",
    resources: Array.isArray(data.resources) ? data.resources.filter((r: unknown): r is string => typeof r === "string") : [],
  })
  return next
}

const resolvePermission = (state: TranscriptState, requestID: string, reply: PermissionReply): TranscriptState => {
  const index = indexOfBlock(state.blocks, requestID)
  if (index < 0) return state
  const block = state.blocks[index]
  if (block.kind !== "permission" || block.resolved) return state
  const next = clone(state)
  next.blocks[index] = { ...block, resolved: reply }
  return next
}

const applyQuestionAsked = (state: TranscriptState, data: Record<string, any>): TranscriptState => {
  const id = typeof data.id === "string" ? data.id : undefined
  if (id === undefined || indexOfBlock(state.blocks, id) >= 0) return state
  const next = clone(state)
  next.blocks.push({
    kind: "question",
    id,
    questions: Array.isArray(data.questions)
      ? data.questions.map((question: Record<string, any>) => ({
          question: typeof question?.question === "string" ? question.question : "",
          header: typeof question?.header === "string" ? question.header : "",
          options: Array.isArray(question?.options)
            ? question.options.map((option: Record<string, any>) => ({
                label: typeof option?.label === "string" ? option.label : "",
                description: typeof option?.description === "string" ? option.description : "",
              }))
            : [],
          multiple: typeof question?.multiple === "boolean" ? question.multiple : undefined,
          custom: typeof question?.custom === "boolean" ? question.custom : undefined,
        }))
      : [],
  })
  return next
}

const resolveQuestion = (state: TranscriptState, requestID: string, resolved: "answered" | "rejected"): TranscriptState => {
  const index = indexOfBlock(state.blocks, requestID)
  if (index < 0) return state
  const block = state.blocks[index]
  if (block.kind !== "question" || block.resolved) return state
  const next = clone(state)
  next.blocks[index] = { ...block, resolved }
  return next
}

const applyCompactionStarted = (state: TranscriptState, data: Record<string, any>, event: RawEvent): TranscriptState => {
  const id = `compaction:${data.messageID ?? event.id ?? ""}`
  if (indexOfBlock(state.blocks, id) >= 0) return state
  const next = clone(state)
  next.blocks.push({
    kind: "compaction",
    id,
    state: "running",
    reason: data.reason === "manual" ? "manual" : data.reason === "auto" ? "auto" : undefined,
  })
  return next
}

const applyCompactionDelta = (state: TranscriptState, data: Record<string, any>, event: RawEvent): TranscriptState => {
  const id = `compaction:${data.messageID ?? event.id ?? ""}`
  const index = indexOfBlock(state.blocks, id)
  if (index < 0) return state
  const block = state.blocks[index]
  if (block.kind !== "compaction") return state
  const text = typeof data.text === "string" ? data.text : ""
  const next = clone(state)
  next.blocks[index] = { ...block, text: truncate((block.text ?? "") + text, 4000) }
  return next
}

const applyCompactionEnded = (state: TranscriptState, data: Record<string, any>, event: RawEvent): TranscriptState => {
  const id = `compaction:${data.messageID ?? event.id ?? ""}`
  const index = indexOfBlock(state.blocks, id)
  const next = clone(state)
  const block: TranscriptBlock =
    index >= 0 && next.blocks[index].kind === "compaction"
      ? {
          ...(next.blocks[index] as CompactionBlock),
          state: "done",
          text: typeof data.text === "string" ? truncate(data.text, 4000) : (next.blocks[index] as CompactionBlock).text,
          recent: typeof data.recent === "string" ? truncate(data.recent, 4000) : undefined,
        }
      : {
          kind: "compaction",
          id,
          state: "done",
          reason: data.reason === "manual" ? "manual" : data.reason === "auto" ? "auto" : undefined,
          text: typeof data.text === "string" ? truncate(data.text, 4000) : undefined,
        }
  setBlock(next.blocks, index, block)
  return next
}

const REVERT_BLOCK_ID = "revert"

const applyRevertStaged = (state: TranscriptState, data: Record<string, any>): TranscriptState => {
  const revert = asRecord(data.revert)
  if (typeof revert.messageID !== "string") return state
  const block: RevertBlock = {
    kind: "revert",
    id: REVERT_BLOCK_ID,
    state: "staged",
    messageID: revert.messageID,
    files: Array.isArray(revert.files) ? revert.files.filter((f: unknown): f is string => typeof f === "string") : undefined,
  }
  const next = clone(state)
  setBlock(next.blocks, indexOfBlock(next.blocks, REVERT_BLOCK_ID), block)
  return next
}

const applyRevertCleared = (state: TranscriptState): TranscriptState => {
  const index = indexOfBlock(state.blocks, REVERT_BLOCK_ID)
  if (index < 0) return state
  const next = clone(state)
  next.blocks.splice(index, 1)
  return next
}

const applyRevertCommitted = (state: TranscriptState, data: Record<string, any>): TranscriptState => {
  if (typeof data.messageID !== "string") return state
  const index = indexOfBlock(state.blocks, REVERT_BLOCK_ID)
  if (index < 0) return state
  const block = state.blocks[index]
  if (block.kind !== "revert") return state
  const next = clone(state)
  next.blocks[index] = { ...block, state: "committed", messageID: data.messageID }
  return next
}

const setAssistantSettled = (state: TranscriptState, id: string, mutate: (block: AssistantBlock) => void): TranscriptState => {
  const existing = settledAssistant(state, id)
  if (!existing) {
    const { next, block } = ensureAssistant(state, id)
    mutate(block)
    return next
  }
  const next = clone(state)
  const block = { ...existing, parts: [...existing.parts] }
  mutate(block)
  setBlock(next.blocks, indexOfBlock(next.blocks, id), block)
  return next
}

const noteRetry = (state: TranscriptState, attempt: number, message: string): TranscriptState => {
  for (let i = state.blocks.length - 1; i >= 0; i--) {
    const block = state.blocks[i]
    if (block.kind === "assistant" && block.status === "running") {
      const next = clone(state)
      next.blocks[i] = { ...block, retryNote: `Retrying (attempt ${attempt}): ${truncate(message, 200)}` }
      return next
    }
  }
  return state
}

const optionalNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const foldEventState = (state: TranscriptState, event: RawEvent): TranscriptState => {
  const data = asRecord(event.data)
  switch (event.type) {
    case "session.next.prompt.admitted":
    case "session.next.prompted":
      return applyPromptEvent(state, data)

    case "session.next.step.started": {
      const id = typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined
      if (id === undefined) return state
      const next = setAssistantSettled(state, id, (block) => {
        block.status = "running"
        block.retryNote = undefined
        if (typeof data.agent === "string") block.agent = data.agent
        const model = formatModel(data.model)
        if (model) block.model = model
      })
      return { ...next, busy: true }
    }

    case "session.next.text.started": {
      if (typeof data.assistantMessageID !== "string" || typeof data.textID !== "string") return state
      return applyText(state, data.assistantMessageID, data.textID, () => {})
    }

    case "session.next.text.delta": {
      if (typeof data.assistantMessageID !== "string" || typeof data.textID !== "string") return state
      const delta = typeof data.delta === "string" ? data.delta : ""
      if (!delta) return state
      return applyText(state, data.assistantMessageID, data.textID, (part) => {
        part.text += delta
        part.streaming = true
      })
    }

    case "session.next.text.ended": {
      if (typeof data.assistantMessageID !== "string" || typeof data.textID !== "string") return state
      const text = typeof data.text === "string" ? data.text : ""
      return applyText(state, data.assistantMessageID, data.textID, (part) => {
        part.text = text
        part.streaming = false
      })
    }

    case "session.next.reasoning.started": {
      if (typeof data.assistantMessageID !== "string" || typeof data.reasoningID !== "string") return state
      return applyReasoning(state, data.assistantMessageID, data.reasoningID, () => {})
    }

    case "session.next.reasoning.delta": {
      if (typeof data.assistantMessageID !== "string" || typeof data.reasoningID !== "string") return state
      const delta = typeof data.delta === "string" ? data.delta : ""
      if (!delta) return state
      return applyReasoning(state, data.assistantMessageID, data.reasoningID, (part) => {
        part.text += delta
        part.streaming = true
      })
    }

    case "session.next.reasoning.ended": {
      if (typeof data.assistantMessageID !== "string" || typeof data.reasoningID !== "string") return state
      const text = typeof data.text === "string" ? data.text : ""
      return applyReasoning(state, data.assistantMessageID, data.reasoningID, (part) => {
        part.text = text
        part.streaming = false
      })
    }

    case "session.next.tool.input.started": {
      if (typeof data.assistantMessageID !== "string" || typeof data.callID !== "string") return state
      return applyTool(state, data.assistantMessageID, data.callID, () => {}, typeof data.name === "string" ? data.name : undefined)
    }

    case "session.next.tool.input.delta": {
      if (typeof data.assistantMessageID !== "string" || typeof data.callID !== "string") return state
      const delta = typeof data.delta === "string" ? data.delta : ""
      if (!delta) return state
      return applyTool(state, data.assistantMessageID, data.callID, (part) => {
        part.input = truncate((part.input ?? "") + delta, 2000)
      })
    }

    case "session.next.tool.input.ended": {
      if (typeof data.assistantMessageID !== "string" || typeof data.callID !== "string") return state
      const input = typeof data.text === "string" ? truncate(data.text, 2000) : undefined
      if (input === undefined) return state
      return applyTool(state, data.assistantMessageID, data.callID, (part) => {
        // Ended is the replayable full-value boundary; it supersedes provisional deltas.
        part.input = input
      })
    }

    case "session.next.tool.called": {
      if (typeof data.assistantMessageID !== "string" || typeof data.callID !== "string") return state
      const name = typeof data.tool === "string" ? data.tool : undefined
      let input: string | undefined
      try {
        input = data.input === undefined ? undefined : truncate(JSON.stringify(data.input) ?? "", 2000)
      } catch {
        input = undefined
      }
      return applyTool(state, data.assistantMessageID, data.callID, (part) => {
        if (input !== undefined) part.input = input
        part.state = "running"
      }, name)
    }

    case "session.next.tool.progress": {
      if (typeof data.assistantMessageID !== "string" || typeof data.callID !== "string") return state
      const progress = textContent(data.content)
      return applyTool(state, data.assistantMessageID, data.callID, (part) => {
        part.state = "running"
        if (progress !== undefined) part.progress = truncate(progress, 400)
      })
    }

    case "session.next.tool.success": {
      if (typeof data.assistantMessageID !== "string" || typeof data.callID !== "string") return state
      const summary = textContent(data.content)
      return applyTool(state, data.assistantMessageID, data.callID, (part) => {
        part.state = "success"
        if (summary !== undefined) part.summary = truncate(summary, 400)
      })
    }

    case "session.next.tool.failed": {
      if (typeof data.assistantMessageID !== "string" || typeof data.callID !== "string") return state
      const message = errText(data.error)
      return applyTool(state, data.assistantMessageID, data.callID, (part) => {
        part.state = "error"
        part.error = truncate(message, 400)
      })
    }

    case "session.next.shell.started": {
      if (typeof data.messageID !== "string" || typeof data.callID !== "string") return state
      return applyShell(state, data.messageID, data.callID, typeof data.command === "string" ? data.command : "")
    }

    case "session.next.shell.ended": {
      if (typeof data.callID !== "string") return state
      return finishShell(state, data.callID, typeof data.output === "string" ? data.output : "")
    }

    case "session.next.step.ended": {
      if (typeof data.assistantMessageID !== "string") return state
      const tokens = asRecord(data.tokens)
      const cache = asRecord(tokens.cache)
      const tokenSummary: TokenSummary = {
        input: optionalNumber(tokens.input),
        output: optionalNumber(tokens.output),
        reasoning: optionalNumber(tokens.reasoning),
        cacheRead: optionalNumber(cache.read),
        cacheWrite: optionalNumber(cache.write),
      }
      const hasTokens = Object.values(tokenSummary).some((value) => value !== undefined)
      const next = setAssistantSettled(state, data.assistantMessageID, (block) => {
        block.status = "done"
        block.retryNote = undefined
        const cost = optionalNumber(data.cost)
        if (cost !== undefined) block.cost = cost
        if (hasTokens) block.tokens = tokenSummary
        if (Array.isArray(data.files)) block.files = data.files.filter((f: unknown): f is string => typeof f === "string")
      })
      return { ...next, busy: false }
    }

    case "session.next.step.failed": {
      if (typeof data.assistantMessageID !== "string") return state
      const message = errText(data.error)
      const next = setAssistantSettled(state, data.assistantMessageID, (block) => {
        block.status = "error"
        block.error = truncate(message, 500)
        block.retryNote = undefined
      })
      return { ...next, busy: false }
    }

    case "session.next.retried": {
      const attempt = typeof data.attempt === "number" ? data.attempt : 0
      return noteRetry(state, attempt, errText(data.error))
    }

    case "session.next.agent.switched":
      return systemNote(state, `agent:${data.messageID ?? event.id ?? ""}`, `Agent switched to ${String(data.agent ?? "?")}`)

    case "session.next.model.switched": {
      const model = formatModel(data.model) ?? "?"
      return systemNote(state, `model:${data.messageID ?? event.id ?? ""}`, `Model switched to ${model}`)
    }

    case "session.next.goal.set":
      return systemNote(state, `goal:${data.messageID ?? event.id ?? ""}`, `Goal set: ${truncate(String(data.goal ?? ""), 200)}`)

    case "session.next.synthetic":
      if (typeof data.messageID !== "string") return state
      return systemNote(state, data.messageID, truncate(typeof data.text === "string" ? data.text : "", 2000))

    case "session.next.context.updated":
      if (typeof data.messageID !== "string") return state
      return systemNote(state, data.messageID, "Context updated")

    case "session.next.compaction.started":
      return applyCompactionStarted(state, data, event)

    case "session.next.compaction.delta":
      return applyCompactionDelta(state, data, event)

    case "session.next.compaction.ended":
      return applyCompactionEnded(state, data, event)

    case "session.next.revert.staged":
      return applyRevertStaged(state, data)

    case "session.next.revert.cleared":
      return applyRevertCleared(state)

    case "session.next.revert.committed":
      return applyRevertCommitted(state, data)

    case "permission.v2.asked":
      return applyPermissionAsked(state, data)

    case "permission.v2.replied":
      if (typeof data.requestID !== "string") return state
      return resolvePermission(state, data.requestID, data.reply === "once" || data.reply === "always" ? data.reply : "reject")

    case "question.v2.asked":
      return applyQuestionAsked(state, data)

    case "question.v2.replied":
      if (typeof data.requestID !== "string") return state
      return resolveQuestion(state, data.requestID, "answered")

    case "question.v2.rejected":
      if (typeof data.requestID !== "string") return state
      return resolveQuestion(state, data.requestID, "rejected")

    default:
      return state
  }
}

const diffBlocks = (before: TranscriptState, after: TranscriptState): Set<string> => {
  const changed = new Set<string>()
  const previous = new Map<string, TranscriptBlock>()
  for (const block of before.blocks) previous.set(block.id, block)
  for (const block of after.blocks) {
    if (previous.get(block.id) !== block) changed.add(block.id)
  }
  const remaining = new Set(after.blocks.map((block) => block.id))
  for (const id of previous.keys()) {
    if (!remaining.has(id)) changed.add(id)
  }
  return changed
}

/**
 * Pure event fold. Returns the next state plus the set of block IDs whose
 * references changed (added, mutated, or removed) so subscribers can render
 * precisely without diffing JSX.
 */
export function foldTranscript(state: TranscriptState, event: RawEvent): FoldResult {
  const next = foldEventState(state, event)
  const changed = next === state ? new Set<string>() : diffBlocks(state, next)
  return { state: next, changed, changedBusy: next.busy !== state.busy }
}

export function applyEvent(state: TranscriptState, event: RawEvent): TranscriptState {
  return foldTranscript(state, event).state
}

export function optimisticUser(
  state: TranscriptState,
  messageID: string,
  text: string,
  attachments: OutgoingAttachment[],
): TranscriptState {
  const files = attachments.map((attachment) => ({
    name: attachment.name,
    mime: attachment.mime,
    image: attachment.mime.startsWith("image/"),
  }))
  return upsertUser(state, messageID, text, files)
}
