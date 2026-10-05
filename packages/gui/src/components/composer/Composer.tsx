import { useRef, useState } from "react"
import type { OutgoingAttachment } from "../../core/fold/transcript"
import { cn } from "../../lib/cn"
import { composerDraftKey, useUiStore } from "../../lib/ui-state"

const MAX_IMAGE_BYTES = 3_500_000
const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const SNIFFED: Array<{ mime: string; test: (bytes: Uint8Array) => boolean }> = [
  { mime: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { mime: "image/gif", test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  {
    mime: "image/webp",
    test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
]

const sniffMime = (bytes: Uint8Array): string | undefined => SNIFFED.find((entry) => entry.test(bytes))?.mime

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

export interface ComposerSubmit {
  text: string
  attachments: OutgoingAttachment[]
}

export function Composer(props: {
  sessionID: string | undefined
  busy: boolean
  disabled?: boolean
  notice?: (message: string) => void
  onSend: (submit: ComposerSubmit) => void
  onInterrupt: () => void
}) {
  const draftKey = composerDraftKey(props.sessionID)
  const text = useUiStore((state) => state.drafts[draftKey] ?? "")
  const setDraft = useUiStore((state) => state.setDraft)
  const delivery = useUiStore((state) => state.delivery)
  const setDelivery = useUiStore((state) => state.setDelivery)
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const addImage = async (blob: Blob, declaredName?: string) => {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.byteLength === 0) return
    const mime = sniffMime(bytes) ?? (blob.type.startsWith("image/") ? blob.type : undefined)
    if (mime === undefined || !ALLOWED_IMAGE_MIMES.has(mime)) {
      props.notice?.("Only PNG, JPEG, GIF, or WebP images can be attached.")
      return
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      props.notice?.(`Skipped oversized image (${declaredName ?? "clipboard"}); max ~3.5 MB.`)
      return
    }
    setAttachments((current) => [...current, { name: declaredName ?? `image.${mime.split("/")[1]}`, mime, dataBase64: toBase64(bytes) }])
  }

  const submit = () => {
    const value = text.trim()
    if (value.length === 0 || props.disabled) return
    setDraft(draftKey, "")
    setHistory((current) => [value, ...current].slice(0, 50))
    setHistoryIndex(-1)
    const sent = attachments
    setAttachments([])
    props.onSend({ text: value, attachments: sent })
  }

  return (
    <div className="border-t border-border bg-background p-2">
      {attachments.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {attachments.map((attachment, index) => (
            <span key={index} className="relative inline-flex items-center gap-1 rounded bg-muted px-1.5 py-1 pe-6 text-xs">
              <img src={`data:${attachment.mime};base64,${attachment.dataBase64}`} alt={attachment.name ?? "attachment"} className="h-8 w-8 rounded object-cover" />
              <button
                type="button"
                aria-label="Remove attachment"
                className="absolute end-1 top-1 rounded bg-background/80 px-1 text-muted-foreground"
                onClick={() => setAttachments((current) => current.filter((_, at) => at !== index))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="Attach image"
          onClick={() => fileRef.current?.click()}
          className="h-9 w-9 shrink-0 rounded-md border border-border text-muted-foreground hover:bg-accent"
        >
          +
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) void addImage(file, file.name)
            event.target.value = ""
          }}
        />
        <textarea
          ref={textareaRef}
          dir="auto"
          rows={1}
          value={text}
          disabled={props.disabled}
          placeholder="Ask prioricode… (Enter to send, Shift+Enter for newline)"
          onChange={(event) => {
            setDraft(draftKey, event.target.value)
            const el = event.currentTarget
            el.style.height = "auto"
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`
          }}
          onPaste={(event) => {
            const item = Array.from(event.clipboardData.items).find((candidate) => candidate.type.startsWith("image/"))
            if (item !== undefined) {
              const file = item.getAsFile()
              if (file !== null) {
                event.preventDefault()
                void addImage(file, "clipboard")
              }
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
              return
            }
            if (event.key === "ArrowUp" && text.length === 0 && history.length > 0) {
              event.preventDefault()
              const next = Math.min(historyIndex + 1, history.length - 1)
              setHistoryIndex(next)
              setDraft(draftKey, history[next] ?? "")
            } else if (event.key === "ArrowDown" && historyIndex >= 0) {
              event.preventDefault()
              const next = historyIndex - 1
              setHistoryIndex(next)
              setDraft(draftKey, next < 0 ? "" : (history[next] ?? ""))
            }
          }}
          className="max-h-40 min-h-[2.25rem] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <select
          value={delivery}
          onChange={(event) => setDelivery(event.target.value === "queue" ? "queue" : "steer")}
          aria-label="Prompt delivery mode"
          title="steer: interject into the running turn · queue: wait for the turn to finish"
          className="h-9 rounded-md border border-border bg-background px-1 text-xs text-muted-foreground"
        >
          <option value="steer">steer</option>
          <option value="queue">queue</option>
        </select>
        {props.busy ? (
          <button
            type="button"
            onClick={props.onInterrupt}
            className="h-9 rounded-md border border-destructive/60 px-3 text-sm text-destructive hover:bg-destructive/10"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={props.disabled || text.trim().length === 0}
            className={cn("h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50")}
          >
            Send
          </button>
        )}
      </div>
    </div>
  )
}
