import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { useKV } from "../context/kv"
import { tint, useTheme } from "../context/theme"
import { big } from "../logo"

// Home screen hero: an oversized block-letter "PrioriCode" wordmark (the `big`
// bitmap in ../logo.ts) rendered as full-block cells. The letters carry a
// horizontal amber→text gradient and sit on a soft radial glow band painted
// with per-cell background tints; a muted tagline centers beneath. A
// left-to-right reveal plays once on startup, followed by a single glint sweep
// across the blocks; after that the component goes completely still — no
// shimmer loop, no requestLive, zero idle repaints. Narrow terminals fall back
// to the compact one-line wordmark so the art is never clipped.
const WORDMARK = "PrioriCode"
const TAGLINE = "the open source AI coding agent"

const FRAME_MS = 33
const REVEAL_MS = 700
const GLINT_MS = 520
const GLINT_WIDTH = 4
const GLINT_STRENGTH = 0.9
const GRADIENT_END = 0.85
const REVEAL_SKEW = 0.6
const MIN_ART_WIDTH = 76

const ART_W = Math.max(...big.map((row) => row.length))
const GLOW_W = 71
const ART_X = Math.floor((GLOW_W - ART_W) / 2)
const GLOW_TOP = -1
const GLOW_ROWS = big.length + 2
const GLOW_CX = (GLOW_W - 1) / 2
const ART_CY = (big.length - 1) / 2

const gauss = (x: number, center: number, sigma: number) => Math.exp(-((x - center) ** 2) / (2 * sigma * sigma))

type Kind = "block" | "word" | "tag" | "glow"

type Cell = {
  char: string
  x: number
  y: number
  kind: Kind
  wordIndex: number
}

const ART: Cell[][] = []
for (let gy = 0; gy < GLOW_ROWS; gy++) {
  const y = GLOW_TOP + gy
  const line = big[y] ?? ""
  const cells: Cell[] = []
  for (let x = 0; x < GLOW_W; x++) {
    const char = x >= ART_X && x - ART_X < line.length ? line[x - ART_X] : " "
    cells.push({ char, x, y, kind: char === "█" ? "block" : "glow", wordIndex: -1 })
  }
  ART.push(cells)
}
ART.push(
  Array.from(
    TAGLINE,
    (char, x): Cell => ({
      char,
      x: x + Math.floor((GLOW_W - TAGLINE.length) / 2),
      y: big.length + 1,
      kind: char === " " ? "glow" : "tag",
      wordIndex: -1,
    }),
  ),
)

const COMPACT: Cell[][] = [
  Array.from(
    WORDMARK,
    (char, x): Cell => ({
      char,
      x: x + Math.floor((TAGLINE.length - WORDMARK.length) / 2),
      y: 0,
      kind: "word",
      wordIndex: x,
    }),
  ),
  Array.from(TAGLINE, (char, x): Cell => ({ char, x, y: 1, kind: "tag", wordIndex: -1 })),
]

const SWEEP = GLOW_W + ART.length * REVEAL_SKEW + 8

export function Logo() {
  const { theme } = useTheme()
  const kv = useKV()
  const dimensions = useTerminalDimensions()
  const [animationsEnabled] = kv.signal("animations_enabled", true)
  const [clock, setClock] = createSignal(animationsEnabled() ? 0 : Number.POSITIVE_INFINITY)

  onMount(() => {
    if (!animationsEnabled()) return
    const start = performance.now()
    const timer = setInterval(() => {
      const elapsed = performance.now() - start
      if (elapsed >= REVEAL_MS + GLINT_MS) {
        clearInterval(timer)
        setClock(Number.POSITIVE_INFINITY)
        return
      }
      setClock(elapsed)
    }, FRAME_MS)
    onCleanup(() => clearInterval(timer))
  })

  const showArt = createMemo(() => dimensions().width >= MIN_ART_WIDTH)
  const rows = createMemo(() => (showArt() ? ART : COMPACT))
  const sweep = createMemo(() => (showArt() ? SWEEP : TAGLINE.length + COMPACT.length * REVEAL_SKEW + 8))

  const reveal = createMemo(() => {
    const p = Math.min(1, clock() / REVEAL_MS)
    return 1 - (1 - p) ** 3
  })

  const glintX = createMemo(() => {
    if (!Number.isFinite(clock())) return Number.NEGATIVE_INFINITY
    const elapsed = clock() - REVEAL_MS
    if (elapsed <= 0) return Number.NEGATIVE_INFINITY
    return -6 + (elapsed / GLINT_MS) * (sweep() + 6)
  })

  const columns = createMemo(() =>
    Array.from({ length: ART_W }, (_, x) => tint(theme.primary, theme.text, (x / (ART_W - 1)) * GRADIENT_END)),
  )

  const wordGradient = createMemo(() =>
    WORDMARK.split("").map((_, i) => tint(theme.primary, theme.text, (i / (WORDMARK.length - 1)) * GRADIENT_END)),
  )

  const renderLine = (cells: Cell[]): JSX.Element[] =>
    cells.map((cell) => {
      if (cell.kind === "glow") {
        const bg = createMemo(() => {
          if (!showArt()) return theme.background
          const falloff = Math.max(0, 1 - Math.abs(cell.y - ART_CY) / (ART_CY + 1.5))
          const alpha = gauss(cell.x, GLOW_CX, 20) * falloff * 0.35 * reveal()
          return alpha < 0.01 ? theme.background : tint(theme.background, theme.primary, alpha)
        })
        return (
          <text bg={bg()} selectable={false}>
            {" "}
          </text>
        )
      }
      if (cell.char === " ") return <text> </text>
      const edge = createMemo(() => Math.max(0, Math.min(1, reveal() * sweep() - cell.x - cell.y * REVEAL_SKEW - 3)))
      const glint = createMemo(() => {
        const raw = 1 - Math.abs(cell.x + cell.y * 0.7 - glintX()) / GLINT_WIDTH
        return raw <= 0 ? 0 : raw * raw * (3 - 2 * raw) * GLINT_STRENGTH
      })
      const fg = createMemo(() => {
        const fade = edge()
        if (fade <= 0) return theme.background
        const base =
          cell.kind === "block"
            ? (columns()[cell.x - ART_X] ?? theme.text)
            : cell.kind === "word"
              ? (wordGradient()[cell.wordIndex] ?? theme.text)
              : theme.textMuted
        return tint(tint(theme.background, base, fade), RGBA.fromInts(255, 250, 235), glint() * fade)
      })
      const content = createMemo(() => (edge() <= 0 ? " " : cell.char))
      return (
        <text
          fg={fg()}
          attributes={cell.kind === "block" || cell.kind === "word" ? TextAttributes.BOLD : undefined}
          selectable={false}
        >
          {content()}
        </text>
      )
    })

  return (
    <box flexDirection="column" alignItems="center">
      <For each={rows()}>{(cells) => <box flexDirection="row">{renderLine(cells)}</box>}</For>
    </box>
  )
}
