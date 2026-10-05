import { useState } from "react"
import { cn } from "../../lib/cn"

export function Composer(props: {
  busy: boolean
  disabled?: boolean
  placeholder?: string
  onSend: (text: string) => void
  onInterrupt: () => void
}) {
  const [text, setText] = useState("")
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  const submit = () => {
    const value = text.trim()
    if (value.length === 0 || props.disabled) return
    setText("")
    setHistory((current) => [value, ...current].slice(0, 50))
    setHistoryIndex(-1)
    props.onSend(value)
  }

  return (
    <div className="border-t border-border bg-background p-2">
      <div className="flex items-end gap-2">
        <textarea
          dir="auto"
          rows={1}
          value={text}
          disabled={props.disabled}
          placeholder={props.placeholder ?? "Ask prioricode… (Enter to send, Shift+Enter for newline)"}
          onChange={(event) => {
            setText(event.target.value)
            const el = event.currentTarget
            el.style.height = "auto"
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`
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
              setText(history[next] ?? "")
            } else if (event.key === "ArrowDown" && historyIndex >= 0) {
              event.preventDefault()
              const next = historyIndex - 1
              setHistoryIndex(next)
              setText(next < 0 ? "" : (history[next] ?? ""))
            }
          }}
          className="max-h-40 min-h-[2.25rem] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
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
