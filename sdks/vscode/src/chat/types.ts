export type ChatStatus = "connecting" | "ready" | "offline" | "auth-mismatch" | "no-cli" | "error"

export interface RawEvent {
  id?: string
  type: string
  durable?: { aggregateID: string; seq: number; version: number }
  data?: unknown
}

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

export interface ToolPart {
  type: "tool"
  callID: string
  name: string
  state: "running" | "success" | "error"
  input?: string
  summary?: string
  error?: string
}

export interface ShellPart {
  type: "shell"
  callID: string
  command: string
  state: "running" | "done"
  output?: string
}

export type AssistantPart = TextPart | ToolPart | ShellPart

export interface AssistantBlock {
  kind: "assistant"
  id: string
  agent?: string
  model?: string
  status: "running" | "done" | "error"
  retryNote?: string
  error?: string
  parts: AssistantPart[]
}

export interface SystemBlock {
  kind: "system"
  id: string
  text: string
  tone: "info" | "error"
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

export type ChatBlock = UserBlock | AssistantBlock | SystemBlock | PermissionBlock | QuestionBlock

export interface ChatState {
  sessionID?: string
  status: ChatStatus
  statusDetail?: string
  blocks: ChatBlock[]
  busy: boolean
  lastSeq: number
}

export function emptyState(): ChatState {
  return { status: "connecting", blocks: [], busy: false, lastSeq: 0 }
}

export interface OutgoingAttachment {
  name: string
  mime: string
  dataBase64: string
}

export type PermissionReply = "once" | "always" | "reject"

export type HostToWebview = { type: "state"; state: ChatState }

export type WebviewToHost =
  | { type: "ready" }
  | { type: "send"; messageID: string; text: string; attachments: OutgoingAttachment[] }
  | { type: "interrupt" }
  | { type: "permission-reply"; requestID: string; reply: PermissionReply }
  | { type: "question-reply"; requestID: string; answers: string[][] }
  | { type: "question-reject"; requestID: string }
  | { type: "new-session" }
  | { type: "retry" }
