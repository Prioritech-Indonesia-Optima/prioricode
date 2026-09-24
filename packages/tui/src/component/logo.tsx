import { TextAttributes } from "@opentui/core"
import { For, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { useKV } from "../context/kv"
import { tint, useTheme } from "../context/theme"

// Home screen hero: the wordmark is the logo. "PrioriCode" is set bold with a
// per-cell gradient that flows from the brand primary into the text color,
// with a muted tagline beneath it. A single left-to-right reveal plays once on
// startup and then the component goes completely still — no shimmer loop, no
// requestLive. The grainy ASCII mark in ../logo.ts is intentionally not used
// here; it still backs the splash, upsell pulse, and CLI banners.
const WORDMARK = "PrioriCode"
const TAGLINE = "the open source AI coding agent"

const FRAME_MS = 33
const REVEAL_MS = 600
const WORDMARK_GRADIENT_END = 0.85

type Cell = { char: string; x: number; offset: number }

const line = (text: string, offset: number): Cell[] => Array.from(text, (char, x) => ({ char, x, offset }))

const LINES: { cells: Cell[]; bold: boolean; tone: "gradient" | "muted" }[] = [
  { cells: line(WORDMARK, 0), bold: true, tone: "gradient" },
  { cells: line(TAGLINE, WORDMARK.length + 1), bold: false, tone: "muted" },
]

const SWEEP = WORDMARK.length + 1 + TAGLINE.length

export function Logo() {
  const { theme } = useTheme()
  const kv = useKV()
  const [animationsEnabled] = kv.signal("animations_enabled", true)
  const [progress, setProgress] = createSignal(animationsEnabled() ? 0 : 1)

  onMount(() => {
    if (!animationsEnabled()) return
    const start = performance.now()
    const timer = setInterval(() => {
      const t = (performance.now() - start) / REVEAL_MS
      if (t >= 1) {
        clearInterval(timer)
        setProgress(1)
        return
      }
      setProgress(1 - (1 - t) ** 3)
    }, FRAME_MS)
    onCleanup(() => clearInterval(timer))
  })

  const gradient = createMemo(() =>
    WORDMARK.split("").map((_, i) =>
      tint(theme.primary, theme.text, (i / (WORDMARK.length - 1)) * WORDMARK_GRADIENT_END),
    ),
  )

  const renderLine = (cells: Cell[], bold: boolean, kind: "gradient" | "muted"): JSX.Element[] =>
    cells.map((cell, index) => {
      if (cell.char === " ") return <text> </text>
      const edge = createMemo(() => Math.max(0, Math.min(1, progress() * SWEEP - cell.offset - cell.x)))
      const fg = createMemo(() => {
        const fade = edge()
        if (fade <= 0) return theme.background
        const from = kind === "gradient" ? gradient()[index] : theme.textMuted
        return tint(theme.background, from, fade)
      })
      const content = createMemo(() => (edge() <= 0 ? " " : cell.char))
      return (
        <text fg={fg()} attributes={bold ? TextAttributes.BOLD : undefined} selectable={false}>
          {content()}
        </text>
      )
    })

  return (
    <box flexDirection="column" alignItems="center">
      <For each={LINES}>{(row) => <box flexDirection="row">{renderLine(row.cells, row.bold, row.tone)}</box>}</For>
    </box>
  )
}
