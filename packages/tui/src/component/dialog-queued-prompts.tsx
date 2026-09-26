import { createMemo } from "solid-js"
import type { Message, Part, UserMessage } from "@prioricode/sdk/v2"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useClipboard } from "../context/clipboard"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { Locale } from "../util/locale"

export type QueuedPrompt = {
  message: UserMessage
  text: string
}

// Steering prompts admitted after the in-flight assistant message began —
// the same derivation as the QUEUED transcript badge.
export function collectQueuedPrompts(messages: Message[], parts: (messageID: string) => Part[]): QueuedPrompt[] {
  const completed = messages.findLastIndex((message) => message.role === "assistant" && message.time.completed)
  const pendingIndex = messages.findLastIndex(
    (message, index) => index > completed && message.role === "assistant" && !message.time.completed,
  )
  if (pendingIndex === -1) return []
  return messages
    .map((message, index) => ({ message, index }))
    .filter(({ message, index }) => index > pendingIndex && message.role === "user")
    .map(({ message }) => ({
      message: message as UserMessage,
      text: parts(message.id)
        .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.synthetic && !part.ignored)
        .map((part) => part.text)
        .join("\n")
        .trim(),
    }))
    .filter((prompt) => prompt.text.length > 0)
}

// Steering prompts already admitted for the in-flight turn (same derivation as
// the QUEUED transcript badge). Selecting one copies its full text; durable
// cancellation is a server API gap — interrupting the turn remains the only
// way to stop processing.
export function DialogQueuedPrompts(props: { prompts: () => QueuedPrompt[] }) {
  const dialog = useDialog()
  const clipboard = useClipboard()
  const toast = useToast()
  const { theme } = useTheme()

  const options = createMemo<DialogSelectOption<string>[]>(() =>
    props.prompts().map((prompt) => ({
      value: prompt.message.id,
      title: Locale.truncate((prompt.text.split("\n")[0] ?? prompt.text).trim(), 70),
      description: Locale.todayTimeOrDateTime(prompt.message.time.created),
      footer: prompt.message.agent,
    })),
  )

  return (
    <DialogSelect
      title="Queued prompts"
      options={options()}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>No prompts queued for the current turn</text>
        </box>
      }
      footer={
        <box paddingLeft={4}>
          <text fg={theme.textMuted}>enter copies the full prompt · esc closes</text>
        </box>
      }
      onSelect={(option) => {
        const prompt = props.prompts().find((item) => item.message.id === option.value)
        if (prompt && clipboard.write) {
          clipboard
            .write(prompt.text)
            .then(() => toast.show({ message: "Queued prompt copied to clipboard", variant: "success" }))
            .catch(() => toast.show({ message: "Failed to copy queued prompt", variant: "error" }))
        }
        dialog.clear()
      }}
    />
  )
}
