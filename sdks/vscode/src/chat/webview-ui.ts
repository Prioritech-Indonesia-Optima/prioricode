import type { ChatState, HostToWebview, WebviewToHost } from "./types"

type Intent = Exclude<WebviewToHost, { type: "ready" }>

interface IdeChatApi {
  render: (state: ChatState) => void
  onIntent: (listener: (intent: Intent) => void) => () => void
  focus: () => void
  destroy: () => void
}

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
declare global {
  interface Window {
    PrioriCodeChat?: {
      mount: (root: HTMLElement, options?: { direction?: "ltr" | "rtl"; locale?: string }) => IdeChatApi
    }
  }
}

const vscode = acquireVsCodeApi()
const stateListeners = new Set<(state: ChatState) => void>()
let chat: IdeChatApi | undefined
let latest: ChatState | undefined

window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as HostToWebview
  if (message?.type !== "state") return
  latest = message.state
  for (const listener of stateListeners) listener(message.state)
})

const mountChat = () => {
  const factory = window.PrioriCodeChat
  if (!factory) {
    setTimeout(mountChat, 50)
    return
  }
  const root = document.getElementById("root") ?? document.body
  chat = factory.mount(root, {
    direction: document.documentElement.getAttribute("dir") === "rtl" ? "rtl" : "ltr",
    locale: document.documentElement.lang || undefined,
  })
  chat.onIntent((intent) => vscode.postMessage(intent))
  if (latest) chat.render(latest)
  vscode.postMessage({ type: "ready" })
}

mountChat()
