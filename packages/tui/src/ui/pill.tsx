import type { RGBA } from "@opentui/core"

// Shared inline badge: padded, bold, colored background. Same idiom as the
// QUEUED / SYSTEM / File transcript badges, extracted for the status bar and
// mode pills.
export function Pill(props: { label: string; bg: RGBA; fg: RGBA }) {
  return (
    <text flexShrink={0}>
      <span style={{ bg: props.bg, fg: props.fg, bold: true }}> {props.label} </span>
    </text>
  )
}
