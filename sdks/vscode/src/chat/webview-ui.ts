import type {
  AssistantBlock,
  ChatBlock,
  ChatState,
  HostToWebview,
  OutgoingAttachment,
  PermissionBlock,
  QuestionBlock,
  UserBlock,
} from "./types"

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
const api = acquireVsCodeApi()

const MAX_RAW_IMAGE_BYTES = 3_500_000
const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

let chat: ChatState | undefined
const pending: OutgoingAttachment[] = []
const localImages = new Map<string, string[]>()

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const transcript = el("transcript")
const input = el<HTMLTextAreaElement>("input")
const sendButton = el<HTMLButtonElement>("send")
const stopButton = el<HTMLButtonElement>("stop")
const newSessionButton = el("new-session")
const attachmentsRow = el("attachments")
const banner = el("banner")
const bannerText = el("banner-text")
const bannerRetry = el("banner-retry")

const post = (message: unknown) => api.postMessage(message)

const div = (className: string, parent?: HTMLElement): HTMLDivElement => {
  const node = document.createElement("div")
  if (className) node.className = className
  if (parent) parent.appendChild(node)
  return node
}

const textNode = (className: string, text: string, parent: HTMLElement): HTMLElement => {
  const node = div(className, parent)
  node.textContent = text
  return node
}

const button = (label: string, parent: HTMLElement, onClick: () => void, secondary = false): HTMLButtonElement => {
  const node = document.createElement("button")
  node.textContent = label
  node.className = secondary ? "secondary" : ""
  node.addEventListener("click", onClick)
  parent.appendChild(node)
  return node
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const sniffImageMime = (bytes: Uint8Array): string | undefined => {
  const head = bytes.subarray(0, 16)
  const ascii = String.fromCharCode(...head.subarray(0, 4))
  if (head[0] === 0x89 && ascii === "\x89PNG") return "image/png"
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg"
  if (ascii === "GIF8") return "image/gif"
  if (ascii === "RIFF" && String.fromCharCode(...head.subarray(8, 12)) === "WEBP") return "image/webp"
  return undefined
}

const renderChips = () => {
  attachmentsRow.replaceChildren()
  pending.forEach((attachment, index) => {
    const chip = div("chip", attachmentsRow)
    const image = document.createElement("img")
    image.src = `data:${attachment.mime};base64,${attachment.dataBase64}`
    image.alt = attachment.name
    chip.appendChild(image)
    button("×", chip, () => {
      pending.splice(index, 1)
      renderChips()
    }).style.padding = "0 5px"
  })
}

const addImage = async (file: File) => {
  const buffer = new Uint8Array(await file.arrayBuffer())
  if (buffer.byteLength > MAX_RAW_IMAGE_BYTES) {
    showTransientBanner(`Image is too large (${Math.round(buffer.byteLength / 1024)} KB); max ~3.5 MB.`)
    return
  }
  let mime = file.type.toLowerCase()
  if (!ALLOWED_IMAGE_MIMES.has(mime)) mime = sniffImageMime(buffer) ?? ""
  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    showTransientBanner("Clipboard image is not a supported format (png/jpeg/gif/webp).")
    return
  }
  pending.push({ name: file.name && file.name !== "image.png" ? file.name : "clipboard.png", mime, dataBase64: toBase64(buffer) })
  renderChips()
}

let bannerTimer: ReturnType<typeof setTimeout> | undefined
const showTransientBanner = (message: string) => {
  if (bannerTimer !== undefined) clearTimeout(bannerTimer)
  bannerText.textContent = message
  banner.classList.add("visible")
  banner.classList.add("error")
  bannerRetry.style.display = "none"
  bannerTimer = setTimeout(() => {
    banner.classList.remove("visible", "error")
    bannerRetry.style.display = ""
    renderBanner()
  }, 5000)
}

const statusMessages: Record<string, string> = {
  connecting: "Connecting to the prioricode service…",
  offline: "The prioricode service is not running.",
  "auth-mismatch": "The prioricode server rejected the stored password.",
  "no-cli": "The prioricode CLI was not found on your PATH.",
  error: "prioricode is unreachable.",
}

const renderBanner = () => {
  if (!chat || chat.status === "ready") {
    if (!banner.classList.contains("error")) banner.classList.remove("visible")
    return
  }
  banner.classList.add("visible")
  bannerText.textContent = chat.statusDetail || statusMessages[chat.status] || chat.status
}

const renderUser = (block: UserBlock): HTMLElement => {
  const node = div("block user")
  textNode("who", "you", node)
  if (block.text) textNode("text", block.text, node)
  const images = localImages.get(block.id) ?? []
  block.files.forEach((file, index) => {
    if (!file.image) {
      textNode("meta", `📎 ${file.name ?? file.mime}`, node)
      return
    }
    if (images[index] !== undefined) {
      const image = document.createElement("img")
      image.className = "pasted"
      image.src = images[index]
      image.alt = file.name ?? "pasted image"
      node.appendChild(image)
    } else {
      textNode("meta", `🖼 ${file.name ?? "image"}`, node)
    }
  })
  return node
}

const renderAssistant = (block: AssistantBlock): HTMLElement => {
  const node = div("block assistant")
  const who = [block.agent, block.model].filter(Boolean).join(" · ")
  textNode("who", who || "prioricode", node)
  for (const part of block.parts) {
    if (part.type === "text") {
      const text = textNode("text", part.text, node)
      if (part.streaming) text.classList.add("status-running")
      continue
    }
    const details = document.createElement("details")
    details.className = "part"
    const summary = document.createElement("summary")
    if (part.type === "tool") {
      summary.textContent = `${part.name} — ${part.state}`
      if (part.state === "error") summary.classList.add("status-error")
    } else {
      summary.textContent = `shell: ${part.command.slice(0, 120)}`
    }
    details.appendChild(summary)
    if (part.type === "tool") {
      if (part.input) {
        const pre = document.createElement("pre")
        pre.textContent = part.input
        details.appendChild(pre)
      }
      if (part.summary) {
        const pre = document.createElement("pre")
        pre.textContent = part.summary
        details.appendChild(pre)
      }
      if (part.error) {
        const pre = document.createElement("pre")
        pre.className = "status-error"
        pre.textContent = part.error
        details.appendChild(pre)
      }
    } else if (part.output) {
      const pre = document.createElement("pre")
      pre.textContent = part.output
      details.appendChild(pre)
    }
    node.appendChild(details)
  }
  if (block.retryNote) textNode("meta", block.retryNote, node)
  if (block.status === "error" && block.error) textNode("meta status-error", block.error, node)
  return node
}

const renderPermission = (block: PermissionBlock): HTMLElement => {
  const node = div("block card")
  textNode("text", `Allow ${block.action}?`, node)
  if (block.resources.length > 0) textNode("meta", block.resources.slice(0, 8).join("\n"), node)
  const buttons = div("buttons", node)
  if (block.resolved) {
    textNode("meta", `Approved: ${block.resolved}`, buttons)
    return node
  }
  const reply = (value: "once" | "always" | "reject") => post({ type: "permission-reply", requestID: block.id, reply: value })
  button("Allow once", buttons, () => reply("once"))
  button("Always allow", buttons, () => reply("always"), true)
  button("Reject", buttons, () => reply("reject"), true)
  return node
}

const renderQuestion = (block: QuestionBlock): HTMLElement => {
  const node = div("block card")
  const selections: HTMLElement[] = []
  for (const question of block.questions) {
    textNode("text", question.header ? `${question.header}: ${question.question}` : question.question, node)
    const group = div("buttons", node)
    const selected = new Set<string>()
    const type = question.multiple ? "checkbox" : "radio"
    for (const option of question.options) {
      const label = document.createElement("label")
      const radio = document.createElement("input")
      radio.type = type
      radio.name = `${block.id}:${question.header}`
      radio.value = option.label
      radio.title = option.description
      radio.addEventListener("change", () => {
        if (radio.checked) {
          if (question.multiple) selected.add(option.label)
          else {
            selected.clear()
            selected.add(option.label)
          }
        } else selected.delete(option.label)
      })
      label.appendChild(radio)
      label.appendChild(document.createTextNode(` ${option.label}`))
      group.appendChild(label)
    }
    if (question.custom !== false) {
      const custom = document.createElement("input")
      custom.type = "text"
      custom.placeholder = "Other…"
      custom.size = 12
      group.appendChild(custom)
      selections.push(custom)
    } else {
      selections.push(document.createElement("input"))
    }
  }
  const buttons = div("buttons", node)
  if (block.resolved) {
    textNode("meta", block.resolved === "answered" ? "Answered" : "Skipped", buttons)
    return node
  }
  button("Submit", buttons, () => {
    const answers = block.questions.map((question, index) => {
      const custom = selections[index] as HTMLInputElement | undefined
      const typed = custom && custom.type === "text" ? custom.value.trim() : ""
      const chosen = Array.from(
        node.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(`${block.id}:${question.header}`)}"]:checked`),
      ).map((candidate) => candidate.value)
      if (typed) chosen.push(typed)
      return chosen
    })
    post({ type: "question-reply", requestID: block.id, answers })
  })
  button("Skip", buttons, () => post({ type: "question-reject", requestID: block.id }), true)
  return node
}

const renderBlock = (block: ChatBlock): HTMLElement | undefined => {
  switch (block.kind) {
    case "user":
      return renderUser(block)
    case "assistant":
      return renderAssistant(block)
    case "permission":
      return renderPermission(block)
    case "question":
      return renderQuestion(block)
    case "system": {
      const node = div(`block system${block.tone === "error" ? " error" : ""}`)
      node.textContent = block.text
      return node
    }
  }
}

const renderTranscript = () => {
  const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80
  transcript.replaceChildren()
  const blocks = chat?.blocks ?? []
  if (blocks.length === 0 && chat?.status === "ready") {
    const empty = div("block", transcript)
    empty.id = "empty"
    const heading = document.createElement("h2")
    heading.textContent = "Welcome to prioricode"
    empty.appendChild(heading)
    textNode("", "What would you like to do? (Ctrl+V pastes images)", empty)
  }
  for (const block of blocks) {
    const node = renderBlock(block)
    if (node) transcript.appendChild(node)
  }
  if (chat?.busy) {
    const working = textNode("block system status-running", "working", transcript)
    working.setAttribute("aria-live", "polite")
  }
  if (nearBottom) transcript.scrollTop = transcript.scrollHeight
}

const renderAll = () => {
  renderBanner()
  renderTranscript()
  stopButton.disabled = !chat?.busy
  sendButton.disabled = chat === undefined || chat.status === "connecting"
}

const send = () => {
  const text = input.value.replace(/\s+$/, "")
  if (!text && pending.length === 0) return
  const messageID = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const images = pending.filter((attachment) => attachment.mime.startsWith("image/")).map((attachment) => `data:${attachment.mime};base64,${attachment.dataBase64}`)
  if (images.length > 0) localImages.set(messageID, images)
  post({ type: "send", messageID, text, attachments: [...pending] })
  pending.length = 0
  input.value = ""
  renderChips()
  renderAll()
}

window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as HostToWebview
  if (message?.type !== "state") return
  chat = message.state
  renderAll()
})

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    send()
  }
})

sendButton.addEventListener("click", send)
stopButton.addEventListener("click", () => post({ type: "interrupt" }))
newSessionButton.addEventListener("click", () => {
  localImages.clear()
  pending.length = 0
  renderChips()
  post({ type: "new-session" })
})
bannerRetry.addEventListener("click", () => post({ type: "retry" }))

document.addEventListener("paste", (event) => {
  const clipboard = event.clipboardData
  if (!clipboard) return
  const items = Array.from(clipboard.items).filter(
    (item) => item.kind === "file" && (item.type.startsWith("image/") || item.type === ""),
  )
  if (items.length === 0) return
  event.preventDefault()
  const text = clipboard.getData("text/plain")
  if (text) {
    const target = input
    const start = target.selectionStart ?? target.value.length
    const end = target.selectionEnd ?? target.value.length
    target.setRangeText(text, start, end, "end")
  }
  for (const item of items) {
    const file = item.getAsFile()
    if (file) void addImage(file)
  }
})

renderAll()
post({ type: "ready" })
