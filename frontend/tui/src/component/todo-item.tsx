import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
  /** Spaces of indent before the status glyph (outline depth). */
  indent?: number
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const indent = " ".repeat(props.indent ?? 0)

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        {indent}[{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        {props.content}
      </text>
    </box>
  )
}
