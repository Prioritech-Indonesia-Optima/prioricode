import { RGBA, TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { For, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { useKV } from "../context/kv"
import { tint, useTheme } from "../context/theme"
import { logo } from "../logo"

const FRAME_MS = 33
const REVEAL_MS = 520
const SHIMMER_MS = 4600
const GLINT_WIDTH = 3.5
const GLINT_STRENGTH = 0.9

type Cell = { char: string; x: number }

const LEFT_WIDTH = logo.left[0]?.length ?? 0
const TOTAL_WIDTH = LEFT_WIDTH + 1 + (logo.right[0]?.length ?? 0)

const cells = (line: string, offset: number): Cell[] => Array.from(line, (char, x) => ({ char, x: x + offset }))

const ROWS = logo.left.map((line, index) => ({
  left: cells(line, 0),
  right: cells(logo.right[index] ?? "", LEFT_WIDTH + 1),
}))

function glyph(char: string) {
  if (char === "_") return { content: " ", shadow: "bg" as const }
  if (char === "^") return { content: "▀", shadow: "bg" as const }
  if (char === "~") return { content: "▀", shadow: "fg" as const }
  if (char === ",") return { content: "▄", shadow: "fg" as const }
  return { content: char, shadow: "none" as const }
}

export function Logo() {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const kv = useKV()
  const [animationsEnabled] = kv.signal("animations_enabled", true)
  const [frame, setFrame] = createSignal(0)

  onMount(() => {
    const start = performance.now()
    const timer = setInterval(() => setFrame(Math.floor((performance.now() - start) / FRAME_MS)), FRAME_MS)
    onCleanup(() => clearInterval(timer))
  })

  // The renderer stops emitting frames once it goes idle, so the glint sweep
  // needs a live request to keep painting (same mechanism as the spinner).
  createEffect(() => {
    if (!animationsEnabled()) return
    renderer.requestLive()
    onCleanup(() => renderer.dropLive())
  })

  const revealX = () => {
    if (!animationsEnabled()) return TOTAL_WIDTH + 4
    const progress = Math.min(1, (frame() * FRAME_MS) / REVEAL_MS)
    return (1 - (1 - progress) ** 3) * (TOTAL_WIDTH + 4) - 2
  }

  const glintX = () => {
    if (!animationsEnabled()) return Number.NEGATIVE_INFINITY
    const elapsed = frame() * FRAME_MS - REVEAL_MS
    if (elapsed < 0) return Number.NEGATIVE_INFINITY
    return -6 + ((elapsed % SHIMMER_MS) / SHIMMER_MS) * (TOTAL_WIDTH + 12)
  }

  const renderLine = (line: Cell[], rowIndex: number, base: () => RGBA, bold: boolean): JSX.Element[] =>
    line.map((cell) => {
      if (cell.char === " ") return <text>{" "}</text>
      const art = glyph(cell.char)
      const attrs = bold ? TextAttributes.BOLD : undefined
      const shadow = createMemo(() => tint(theme.background, base(), 0.25))
      const edge = createMemo(() => Math.max(0, Math.min(1, revealX() - cell.x)))
      const glint = createMemo(() => {
        const raw = 1 - Math.abs(cell.x + rowIndex * 0.7 - glintX()) / GLINT_WIDTH
        return raw <= 0 ? 0 : raw * raw * (3 - 2 * raw) * GLINT_STRENGTH
      })
      const fg = createMemo(() => {
        const fade = edge()
        if (fade <= 0) return theme.background
        const from = art.shadow === "fg" ? shadow() : base()
        return tint(tint(theme.background, from, fade), theme.primary, glint() * fade)
      })
      const bg = createMemo(() => {
        if (art.shadow !== "bg") return undefined
        const fade = edge()
        if (fade <= 0) return theme.background
        return tint(tint(theme.background, shadow(), fade), theme.primary, glint() * fade * 0.5)
      })
      const content = createMemo(() => (edge() <= 0 ? " " : art.content))
      return (
        <text fg={fg()} bg={bg()} attributes={attrs} selectable={false}>
          {content()}
        </text>
      )
    })

  return (
    <box>
      <For each={ROWS}>
        {(row, index) => (
          <box flexDirection="row" gap={1}>
            <box flexDirection="row">{renderLine(row.left, index(), () => theme.textMuted, false)}</box>
            <box flexDirection="row">{renderLine(row.right, index(), () => theme.text, true)}</box>
          </box>
        )}
      </For>
    </box>
  )
}
