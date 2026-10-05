import { renderMarkdown } from "./markdown"
import { sniffImageMime, toBase64, validateImage, type ImageRejection } from "./paste"
import {
  defaultStrings,
  type AssistantBlock,
  type ChatBlock,
  type ChatState,
  type IdeChatApi,
  type Intent,
  type MountOptions,
  type OutgoingAttachment,
  type PermissionBlock,
  type QuestionBlock,
  type Strings,
  type UserBlock,
} from "./types"

export const DEFAULT_MAX_IMAGE_BYTES = 3_500_000
export const DEFAULT_ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "yi", "ps", "sd", "ku"])

const initialState = (): ChatState => ({ status: "connecting", blocks: [], busy: false, lastSeq: 0 })

const makeMessageId = () => `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

const el = <T extends HTMLElement = HTMLElement>(
  tag: string,
  className: string | undefined,
  parent?: HTMLElement,
): T => {
  const node = document.createElement(tag) as T
  if (className) node.className = className
  parent?.appendChild(node)
  return node
}

const text = (parent: HTMLElement, className: string, value: string): HTMLElement => {
  const node = el("span", className, parent)
  node.textContent = value
  return node
}

const makeButton = (label: string, className: string, parent: HTMLElement, onClick: () => void): HTMLButtonElement => {
  const node = el<HTMLButtonElement>("button", className, parent)
  node.type = "button"
  node.textContent = label
  node.addEventListener("click", onClick)
  return node
}

const detectDirection = (options: MountOptions | undefined): "ltr" | "rtl" => {
  if (options?.direction) return options.direction
  const locale = options?.locale ?? navigator.language ?? document.documentElement.lang ?? "en"
  if (RTL_LANGUAGES.has(locale.slice(0, 2).toLowerCase())) return "rtl"
  const hostDir = document.documentElement.getAttribute("dir")
  return hostDir === "rtl" ? "rtl" : "ltr"
}

export function mount(root: HTMLElement, options?: MountOptions): IdeChatApi {
  const strings: Strings = { ...defaultStrings, ...(options?.strings ?? {}) }
  const maxImageBytes = options?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES
  const allowedMimes = options?.allowedImageMimes ?? DEFAULT_ALLOWED_IMAGE_MIMES
  const direction = detectDirection(options)

  let state = initialState()
  let transient: { message: string; expires: number } | undefined
  let transientTimer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false
  const listeners = new Set<(intent: Intent) => void>()
  const pending: OutgoingAttachment[] = []
  const sentImages = new Map<string, string[]>()
  const openCards = new Set<string>()
  const questionDrafts = new Map<string, { labels: Set<string>[]; custom: string[] }>()

  const dispatch = (intent: Intent) => {
    for (const listener of listeners) listener(intent)
  }

  // ----- skeleton -----
  const chat = el<HTMLDivElement>("div", "pc-chat")
  chat.setAttribute("dir", direction)
  root.appendChild(chat)

  const header = el("header", "pc-header", chat)
  const statusDot = el("span", "pc-status-dot", header)
  text(header, "pc-brand", "prioricode")
  const serverLabel = text(header, "pc-server-label", "")
  serverLabel.hidden = true
  el("span", "pc-spacer", header)
  const busyPill = text(header, "pc-busy", strings.working)
  busyPill.setAttribute("aria-live", "polite")
  const newSessionButton = makeButton(strings.newSession, "pc-btn pc-btn-ghost", header, () =>
    dispatch({ type: "new-session" }),
  )
  newSessionButton.hidden = true

  const banner = el("div", "pc-banner", chat)
  banner.setAttribute("role", "alert")
  const bannerText = text(banner, "pc-banner-text", "")
  const bannerRetry = makeButton(strings.retry, "pc-btn pc-btn-small", banner, () => dispatch({ type: "retry" }))

  const transcript = el<HTMLElement>("main", "pc-transcript", chat)
  transcript.tabIndex = 0

  const composer = el("footer", "pc-composer", chat)
  const chips = el("div", "pc-chips", composer)
  chips.hidden = true
  const inputRow = el("div", "pc-input-row", composer)
  const attachButton = makeButton("+", "pc-icon-btn", inputRow, () => fileInput.click())
  attachButton.title = strings.attach
  const textarea = el<HTMLTextAreaElement>("textarea", "pc-textarea", inputRow)
  textarea.rows = 1
  textarea.placeholder = strings.placeholder
  const stopButton = makeButton("◼", "pc-icon-btn pc-btn-stop", inputRow, () => dispatch({ type: "interrupt" }))
  stopButton.title = strings.stop
  stopButton.hidden = true
  const sendButton = makeButton("↑", "pc-icon-btn pc-btn-send", inputRow, () => send())
  sendButton.title = strings.send
  const fileInput = el<HTMLInputElement>("input", "pc-file-input", composer)
  fileInput.type = "file"
  fileInput.accept = allowedMimes.join(",")
  fileInput.multiple = true

  // ----- attachments -----
  const addImage = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const validation = validateImage(bytes, file.type, { maxBytes: maxImageBytes, allowedMimes })
    if (!validation.ok) {
      showTransient(strings.rejections[validation.reason as ImageRejection["reason"]] ?? validation.reason)
      return
    }
    const name = file.name && file.name !== "image.png" ? file.name : `clipboard.${validation.mime.split("/")[1]}`
    pending.push({ name, mime: validation.mime, dataBase64: toBase64(bytes) })
    renderChips()
  }

  const renderChips = () => {
    chips.replaceChildren()
    chips.hidden = pending.length === 0
    pending.forEach((attachment, index) => {
      const chip = el("div", "pc-chip", chips)
      const image = el<HTMLImageElement>("img", undefined, chip)
      image.src = `data:${attachment.mime};base64,${attachment.dataBase64}`
      image.alt = attachment.name
      const remove = makeButton("×", "pc-chip-remove", chip, () => {
        pending.splice(index, 1)
        renderChips()
      })
      remove.setAttribute("aria-label", strings.removeAttachment)
    })
  }

  // ----- composer -----
  const autosize = () => {
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`
  }

  const send = () => {
    const body = textarea.value.replace(/\s+$/, "")
    if (!body && pending.length === 0) return
    const messageID = makeMessageId()
    if (pending.length > 0) {
      sentImages.set(
        messageID,
        pending.map((attachment) => `data:${attachment.mime};base64,${attachment.dataBase64}`),
      )
    }
    dispatch({ type: "send", messageID, text: body, attachments: [...pending] })
    pending.length = 0
    textarea.value = ""
    autosize()
    renderChips()
    render()
  }

  textarea.addEventListener("input", autosize)
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      send()
    }
  })
  const handlePaste = (event: ClipboardEvent) => {
    const clipboard = event.clipboardData
    if (!clipboard) return
    const images = Array.from(clipboard.items).filter(
      (item) => item.kind === "file" && (item.type.startsWith("image/") || item.type === ""),
    )
    if (images.length === 0) return
    event.preventDefault()
    const plain = clipboard.getData("text/plain")
    if (plain && event.target !== textarea) {
      textarea.setRangeText(plain, textarea.selectionStart ?? undefined, textarea.selectionEnd ?? undefined, "end")
      autosize()
    }
    for (const item of images) {
      const file = item.getAsFile()
      if (file) void addImage(file)
    }
  }
  textarea.addEventListener("paste", handlePaste)
  chat.addEventListener("paste", (event) => {
    if (event.target !== textarea) handlePaste(event as ClipboardEvent)
  })
  fileInput.addEventListener("change", () => {
    for (const file of Array.from(fileInput.files ?? [])) void addImage(file)
    fileInput.value = ""
  })

  // ----- banners -----
  const showTransient = (message: string) => {
    transient = { message, expires: Date.now() + 5000 }
    renderBanner()
  }

  const renderBanner = () => {
    const active = transient !== undefined && transient.expires > Date.now()
    const statusMessage =
      state.status !== "ready" ? state.statusDetail || strings.status[state.status] || state.status : undefined
    const message = active && transient !== undefined ? transient.message : statusMessage
    banner.hidden = message === undefined
    banner.classList.toggle("pc-banner-error", active || state.status === "error" || state.status === "auth-mismatch")
    bannerText.textContent = message ?? ""
    bannerRetry.hidden = active || state.status === "connecting"
    if (transientTimer !== undefined) clearTimeout(transientTimer)
    if (active && transient) {
      transientTimer = setTimeout(
        () => {
          transient = undefined
          if (!destroyed) renderBanner()
        },
        transient.expires - Date.now() + 50,
      )
    }
  }

  // ----- transcript -----
  const pre = (parent: HTMLElement, className: string, value: string) => {
    const node = el("pre", className, parent)
    node.setAttribute("dir", "ltr")
    node.textContent = value
  }

  const collapsible = (
    parent: HTMLElement,
    key: string,
    summary: HTMLElement,
    className: string,
  ): HTMLDetailsElement => {
    const details = el<HTMLDetailsElement>("details", className, parent)
    details.appendChild(summary)
    details.open = openCards.has(key)
    details.addEventListener("toggle", () => {
      if (details.open) openCards.add(key)
      else openCards.delete(key)
    })
    return details
  }

  const stateDot = (parent: HTMLElement, status: "running" | "success" | "error" | "done") => {
    const dot = el("span", `pc-state pc-state-${status}`, parent)
    dot.setAttribute("aria-hidden", "true")
  }

  const renderUser = (block: UserBlock) => {
    const message = el("div", "pc-msg pc-msg-user", transcript)
    const bubble = el("div", "pc-bubble", message)
    if (block.text) {
      const body = el("div", "pc-user-text", bubble)
      body.setAttribute("dir", "auto")
      body.textContent = block.text
    }
    const images = sentImages.get(block.id) ?? []
    block.files.forEach((file, index) => {
      if (file.image && images[index] !== undefined) {
        const image = el<HTMLImageElement>("img", "pc-attach-img", bubble)
        image.src = images[index]
        image.alt = file.name ?? "attachment"
        image.loading = "lazy"
      } else {
        const chip = el("span", "pc-file-chip", bubble)
        const label = el("bdi", undefined, chip)
        label.textContent = `${file.image ? "🖼" : "📎"} ${file.name ?? file.mime}`
      }
    })
  }

  const renderAssistant = (block: AssistantBlock) => {
    const message = el("div", "pc-msg pc-msg-assistant", transcript)
    const meta = text(message, "pc-meta", [strings.assistant, block.agent, block.model].filter(Boolean).join(" · "))
    meta.setAttribute("dir", "auto")
    for (const part of block.parts) {
      if (part.type === "text") {
        const body = el("div", "pc-md", message)
        body.setAttribute("dir", "auto")
        body.innerHTML = renderMarkdown(part.text)
        if (part.streaming) el("span", "pc-cursor", body).textContent = "▋"
        continue
      }
      const key = `${part.type}:${part.callID}`
      if (part.type === "tool") {
        const summary = el("summary", undefined)
        stateDot(summary, part.state)
        const name = el("bdi", "pc-part-name", summary)
        name.textContent = part.name
        if (part.state === "running") el("span", "pc-ellipsis", summary)
        const details = collapsible(message, key, summary, `pc-part pc-part-tool pc-part-${part.state}`)
        if (part.input) pre(details, "pc-pre pc-pre-input", part.input)
        if (part.summary) pre(details, "pc-pre pc-pre-output", part.summary)
        if (part.error) pre(details, "pc-pre pc-pre-error", part.error)
      } else {
        const summary = el("summary", undefined)
        stateDot(summary, part.state === "done" ? "success" : "running")
        const command = el("bdi", "pc-part-name", summary)
        command.setAttribute("dir", "ltr")
        command.textContent = `$ ${part.command}`
        const details = collapsible(message, key, summary, "pc-part pc-part-shell")
        if (part.output) pre(details, "pc-pre pc-pre-output", part.output)
      }
    }
    if (block.retryNote) {
      const note = text(message, "pc-note pc-note-warn", block.retryNote)
      note.setAttribute("dir", "auto")
    }
    if (block.status === "error" && block.error) {
      const note = text(message, "pc-note pc-note-error", block.error)
      note.setAttribute("dir", "auto")
    }
  }

  const renderPermission = (block: PermissionBlock) => {
    const message = el("div", "pc-msg", transcript)
    const card = el("div", `pc-card pc-card-permission${block.resolved ? " pc-card-resolved" : ""}`, message)
    const title = el("div", "pc-card-title", card)
    if (block.resolved) {
      title.textContent = `${strings.resolved} `
      text(title, "pc-resolved-badge", block.resolved === "reject" ? strings.rejected : strings.approved)
    } else {
      title.appendChild(document.createTextNode(`${strings.allow} `))
      const action = el("bdi", "pc-card-action", title)
      action.textContent = block.action
      title.appendChild(document.createTextNode("?"))
    }
    if (block.resources.length > 0) {
      const list = el("ul", "pc-resources", card)
      for (const resource of block.resources.slice(0, 10)) {
        const item = el("li", undefined, list)
        const code = el("code", undefined, item)
        code.setAttribute("dir", "ltr")
        code.textContent = resource
      }
      if (block.resources.length > 10) {
        const more = el("li", "pc-more", list)
        more.textContent = `+${block.resources.length - 10} more`
      }
    }
    if (block.resolved) return
    const actions = el("div", "pc-card-actions", card)
    makeButton(strings.allowOnce, "pc-btn", actions, () =>
      dispatch({ type: "permission-reply", requestID: block.id, reply: "once" }),
    )
    makeButton(strings.allowAlways, "pc-btn pc-btn-secondary", actions, () =>
      dispatch({ type: "permission-reply", requestID: block.id, reply: "always" }),
    )
    makeButton(strings.reject, "pc-btn pc-btn-danger", actions, () =>
      dispatch({ type: "permission-reply", requestID: block.id, reply: "reject" }),
    )
  }

  const renderQuestion = (block: QuestionBlock) => {
    const message = el("div", "pc-msg", transcript)
    const card = el("div", `pc-card pc-card-question${block.resolved ? " pc-card-resolved" : ""}`, message)
    if (block.resolved) {
      text(card, "pc-card-title", block.resolved === "answered" ? strings.answered : strings.skipped)
      return
    }
    const draft = questionDrafts.get(block.id) ?? {
      labels: block.questions.map(() => new Set<string>()),
      custom: block.questions.map(() => ""),
    }
    questionDrafts.set(block.id, draft)
    block.questions.forEach((question, questionIndex) => {
      const group = el("div", "pc-question", card)
      const title = text(
        group,
        "pc-question-title",
        question.header ? `${question.header}: ${question.question}` : question.question,
      )
      title.setAttribute("dir", "auto")
      const options = el("div", "pc-options", group)
      for (const option of question.options) {
        const label = el("label", "pc-option", options)
        const input = el<HTMLInputElement>("input", undefined, label)
        input.type = question.multiple ? "checkbox" : "radio"
        input.name = `question-${block.id}-${questionIndex}`
        input.value = option.label
        input.checked = draft.labels[questionIndex]?.has(option.label) ?? false
        input.addEventListener("change", () => {
          const selected = draft.labels[questionIndex]
          if (!selected) return
          if (question.multiple) {
            if (input.checked) selected.add(option.label)
            else selected.delete(option.label)
          } else {
            selected.clear()
            if (input.checked) selected.add(option.label)
          }
        })
        const optionText = text(label, "pc-option-text", option.label)
        optionText.setAttribute("dir", "auto")
        if (option.description) {
          const description = text(label, "pc-option-description", option.description)
          description.setAttribute("dir", "auto")
        }
      }
      if (question.custom !== false) {
        const custom = el<HTMLInputElement>("input", "pc-custom", group)
        custom.type = "text"
        custom.placeholder = strings.other
        custom.value = draft.custom[questionIndex] ?? ""
        custom.addEventListener("input", () => {
          draft.custom[questionIndex] = custom.value
        })
      }
    })
    const actions = el("div", "pc-card-actions", card)
    makeButton(strings.submit, "pc-btn", actions, () => {
      const answers = block.questions.map((_question, index) => {
        const labels = Array.from(draft.labels[index] ?? [])
        const typed = (draft.custom[index] ?? "").trim()
        if (typed) labels.push(typed)
        return labels
      })
      questionDrafts.delete(block.id)
      dispatch({ type: "question-reply", requestID: block.id, answers })
    })
    makeButton(strings.skip, "pc-btn pc-btn-secondary", actions, () => {
      questionDrafts.delete(block.id)
      dispatch({ type: "question-reject", requestID: block.id })
    })
  }

  const renderBlock = (block: ChatBlock) => {
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
        const note = text(transcript, `pc-note${block.tone === "error" ? " pc-note-error" : ""}`, block.text)
        note.setAttribute("dir", "auto")
        return note
      }
    }
  }

  const render = () => {
    const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80
    transcript.replaceChildren()
    statusDot.dataset.status = state.status
    newSessionButton.hidden = state.status !== "ready" || state.blocks.length === 0
    busyPill.hidden = !state.busy
    stopButton.hidden = !state.busy
    sendButton.disabled = state.status === "connecting"
    serverLabel.hidden = !state.serverUrl
    if (state.serverUrl) serverLabel.textContent = state.serverUrl
    renderBanner()
    if (state.blocks.length === 0 && state.status === "ready") {
      const welcome = el("div", "pc-welcome", transcript)
      text(welcome, "pc-welcome-title", strings.welcomeTitle)
      text(welcome, "pc-welcome-subtitle", strings.welcomeSubtitle)
      text(welcome, "pc-welcome-hint", strings.welcomeHint)
    }
    for (const block of state.blocks) renderBlock(block)
    if (nearBottom) transcript.scrollTop = transcript.scrollHeight
  }

  render()

  return {
    render(next) {
      if (destroyed) return
      state = next
      render()
    },
    onIntent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    focus() {
      textarea.focus()
    },
    destroy() {
      destroyed = true
      if (transientTimer !== undefined) clearTimeout(transientTimer)
      listeners.clear()
      chat.remove()
    },
  }
}

export { sniffImageMime, toBase64, validateImage } from "./paste"
export { renderMarkdown } from "./markdown"
export { defaultStrings } from "./types"
export type {
  AssistantBlock,
  ChatBlock,
  ChatState,
  IdeChatApi,
  Intent,
  MountOptions,
  OutgoingAttachment,
  Strings,
} from "./types"
