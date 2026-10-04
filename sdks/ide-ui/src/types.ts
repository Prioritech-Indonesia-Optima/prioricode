export type ChatStatus = "connecting" | "ready" | "offline" | "auth-mismatch" | "no-cli" | "error"

export interface AttachmentMeta {
  name?: string
  mime: string
  image: boolean
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

export interface UserBlock {
  kind: "user"
  id: string
  text: string
  files: AttachmentMeta[]
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
  serverUrl?: string
  status: ChatStatus
  statusDetail?: string
  blocks: ChatBlock[]
  busy: boolean
  lastSeq: number
}

export interface OutgoingAttachment {
  name: string
  mime: string
  dataBase64: string
}

export type PermissionReply = "once" | "always" | "reject"

export type Intent =
  | { type: "send"; messageID: string; text: string; attachments: OutgoingAttachment[] }
  | { type: "interrupt" }
  | { type: "permission-reply"; requestID: string; reply: PermissionReply }
  | { type: "question-reply"; requestID: string; answers: string[][] }
  | { type: "question-reject"; requestID: string }
  | { type: "new-session" }
  | { type: "retry" }

export interface Strings {
  welcomeTitle: string
  welcomeSubtitle: string
  welcomeHint: string
  placeholder: string
  newSession: string
  retry: string
  attach: string
  send: string
  stop: string
  removeAttachment: string
  allow: string
  allowOnce: string
  allowAlways: string
  reject: string
  approved: string
  rejected: string
  resolved: string
  skip: string
  submit: string
  other: string
  answered: string
  skipped: string
  working: string
  you: string
  assistant: string
  status: Record<string, string>
  rejections: Record<string, string>
}

export const defaultStrings: Strings = {
  welcomeTitle: "Welcome to prioricode",
  welcomeSubtitle: "What would you like to do?",
  welcomeHint: "Paste an image with Ctrl+V, or attach a file with +",
  placeholder: "Ask prioricode…",
  newSession: "New session",
  retry: "Retry",
  attach: "Attach image",
  send: "Send",
  stop: "Stop",
  removeAttachment: "Remove attachment",
  allow: "Allow",
  allowOnce: "Allow once",
  allowAlways: "Always allow",
  reject: "Reject",
  approved: "approved",
  rejected: "rejected",
  resolved: "Permission",
  skip: "Skip",
  submit: "Submit",
  other: "Other…",
  answered: "Answered",
  skipped: "Skipped",
  working: "working",
  you: "you",
  assistant: "prioricode",
  status: {
    connecting: "Connecting to the prioricode service…",
    offline: "The prioricode service is not running.",
    "auth-mismatch": "The prioricode server rejected the stored password.",
    "no-cli": "The prioricode CLI was not found on your PATH.",
    error: "prioricode is unreachable.",
  },
  rejections: {
    too_large: "Image is too large.",
    unsupported: "Unsupported image format (png/jpeg/gif/webp).",
  },
}

export interface MountOptions {
  direction?: "ltr" | "rtl"
  locale?: string
  strings?: Partial<Strings>
  maxImageBytes?: number
  allowedImageMimes?: string[]
}

export interface IdeChatApi {
  render: (state: ChatState) => void
  onIntent: (listener: (intent: Intent) => void) => () => void
  focus: () => void
  destroy: () => void
}
