import type {
  AssistantBlock,
  AssistantPart,
  AttachmentMeta,
  ChatBlock,
  ChatState,
  OutgoingAttachment,
  PermissionReply,
  RawEvent,
} from "./types"

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

const clone = (state: ChatState): ChatState => ({ ...state, blocks: [...state.blocks] })

const indexOfBlock = (blocks: ChatBlock[], id: string | undefined): number =>
  id === undefined ? -1 : blocks.findIndex((block) => block.id === id)

const setBlock = (blocks: ChatBlock[], index: number, block: ChatBlock) => {
  if (index >= 0) blocks[index] = block
  else blocks.push(block)
}

const ensureAssistant = (state: ChatState, id: string): { next: ChatState; block: AssistantBlock } => {
  const next = clone(state)
  const index = indexOfBlock(next.blocks, id)
  if (index >= 0 && next.blocks[index].kind === "assistant") {
    return { next, block: next.blocks[index] as AssistantBlock }
  }
  const block: AssistantBlock = { kind: "assistant", id, status: "running", parts: [] }
  next.blocks.push(block)
  return { next, block }
}

const settledAssistant = (state: ChatState, id: string): AssistantBlock | undefined => {
  const block = state.blocks.find((candidate) => candidate.id === id)
  return block && block.kind === "assistant" ? block : undefined
}

const upsertPart = <P extends AssistantPart>(
  state: ChatState,
  assistantID: string,
  match: (part: AssistantPart) => part is P,
  create: () => P,
): { next: ChatState; part: P } => {
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

const isTextPart = (part: AssistantPart): part is AssistantPart & { type: "text" } => part.type === "text"
const isToolPart = (part: AssistantPart): part is Extract<AssistantPart, { type: "tool" }> => part.type === "tool"
const isShellPart = (part: AssistantPart): part is Extract<AssistantPart, { type: "shell" }> => part.type === "shell"

const applyText = (
  state: ChatState,
  assistantID: string,
  textID: string,
  mutate: (part: { text: string; streaming: boolean }) => void,
): ChatState => {
  const { next, part } = upsertPart(state, assistantID, isTextPart, () => ({ type: "text", textID, text: "", streaming: true }))
  mutate(part)
  return next
}

const applyTool = (
  state: ChatState,
  assistantID: string,
  callID: string,
  mutate: (part: { state: "running" | "success" | "error"; name?: string; input?: string; summary?: string; error?: string }) => void,
  name?: string,
): ChatState => {
  const { next, part } = upsertPart(state, assistantID, isToolPart, () => ({
    type: "tool",
    callID,
    name: name ?? "tool",
    state: "running",
  }))
  if (name !== undefined) part.name = name
  mutate(part)
  return next
}

const applyShell = (state: ChatState, messageID: string, callID: string, command: string): ChatState => {
  const { next, part } = upsertPart(state, messageID, isShellPart, () => ({
    type: "shell",
    callID,
    command,
    state: "running",
  }))
  part.command = command
  return next
}

const finishShell = (state: ChatState, callID: string, output: string): ChatState => {
  for (let i = state.blocks.length - 1; i >= 0; i--) {
    const block = state.blocks[i]
    if (block.kind !== "assistant") continue
    const index = block.parts.findIndex((part) => part.type === "shell" && part.callID === callID)
    if (index < 0) continue
    const next = clone(state)
    const parts = [...block.parts]
    parts[index] = { ...(parts[index] as Extract<AssistantPart, { type: "shell" }>), state: "done", output: truncate(output, 4000) }
    setBlock(next.blocks, i, { ...block, parts })
    return next
  }
  return state
}

const systemNote = (state: ChatState, id: string, text: string, tone: "info" | "error" = "info"): ChatState => {
  const next = clone(state)
  const index = indexOfBlock(next.blocks, id)
  if (index >= 0) return state
  next.blocks.push({ kind: "system", id, text, tone })
  return next
}

const upsertUser = (state: ChatState, id: string, text: string, files: AttachmentMeta[]): ChatState => {
  const next = clone(state)
  const index = indexOfBlock(next.blocks, id)
  const block: ChatBlock = { kind: "user", id, text, files }
  setBlock(next.blocks, index, block)
  return next
}

const applyPromptEvent = (state: ChatState, data: Record<string, any>): ChatState => {
  const messageID = typeof data.messageID === "string" ? data.messageID : undefined
  if (messageID === undefined) return state
  const prompt = asRecord(data.prompt)
  const existing = state.blocks.find((block) => block.id === messageID)
  if (existing && existing.kind === "user") return state
  const text = typeof prompt.text === "string" ? prompt.text : ""
  const files = Array.isArray(prompt.files) ? prompt.files.map(attachmentMeta) : []
  return upsertUser(state, messageID, text, files)
}

const applyPermissionAsked = (state: ChatState, data: Record<string, any>): ChatState => {
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

const resolvePermission = (state: ChatState, requestID: string, reply: PermissionReply): ChatState => {
  const index = indexOfBlock(state.blocks, requestID)
  if (index < 0) return state
  const block = state.blocks[index]
  if (block.kind !== "permission" || block.resolved) return state
  const next = clone(state)
  next.blocks[index] = { ...block, resolved: reply }
  return next
}

const applyQuestionAsked = (state: ChatState, data: Record<string, any>): ChatState => {
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

const resolveQuestion = (state: ChatState, requestID: string, resolved: "answered" | "rejected"): ChatState => {
  const index = indexOfBlock(state.blocks, requestID)
  if (index < 0) return state
  const block = state.blocks[index]
  if (block.kind !== "question" || block.resolved) return state
  const next = clone(state)
  next.blocks[index] = { ...block, resolved }
  return next
}

const setAssistantSettled = (state: ChatState, id: string, mutate: (block: AssistantBlock) => void): ChatState => {
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

const noteRetry = (state: ChatState, attempt: number, message: string): ChatState => {
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

export function applyEvent(state: ChatState, event: RawEvent): ChatState {
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

    case "session.next.tool.input.started": {
      if (typeof data.assistantMessageID !== "string" || typeof data.callID !== "string") return state
      return applyTool(state, data.assistantMessageID, data.callID, () => {}, typeof data.name === "string" ? data.name : undefined)
    }

    case "session.next.tool.input.ended": {
      if (typeof data.assistantMessageID !== "string" || typeof data.callID !== "string") return state
      const input = typeof data.text === "string" ? truncate(data.text, 2000) : undefined
      return applyTool(state, data.assistantMessageID, data.callID, (part) => {
        if (input !== undefined && part.input === undefined) part.input = input
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
      const next = setAssistantSettled(state, data.assistantMessageID, (block) => {
        block.status = "done"
        block.retryNote = undefined
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
      return systemNote(state, `compaction:${data.messageID ?? event.id ?? ""}`, "Compacting context…")

    case "session.next.compaction.ended":
      return systemNote(state, `compaction-ended:${data.messageID ?? event.id ?? ""}`, "Context compacted")

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

export function optimisticUser(
  state: ChatState,
  messageID: string,
  text: string,
  attachments: OutgoingAttachment[],
): ChatState {
  const files = attachments.map((attachment) => ({
    name: attachment.name,
    mime: attachment.mime,
    image: attachment.mime.startsWith("image/"),
  }))
  return upsertUser(state, messageID, text, files)
}
