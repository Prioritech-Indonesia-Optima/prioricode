import { TextAttributes, type OptimizedBuffer, RGBA } from "@opentui/core"
import { big, tagline } from "../logo"
import { type Rgb, toRgb } from "./bg-pulse-render"

// Painter for the animated home hero (`HomeHero`) — the "Re-materialize"
// design. The block wordmark shares the art of the static `Logo` (the `big`
// bitmap on a soft glow band with the tagline beneath) but lives on a loop:
//   - most of the time it sits solid with a slow shimmer wave and rare
//     warm-white twinkles, glow band breathing underneath
//   - on a ~12s cycle it dissolves left→right into drifting code glyphs,
//     holds as noise for a beat, then re-materializes in the same order
//   - each completed reform gets a glint sweep (the first one plays right
//     after the startup reveal)
// Everything is derived from the accumulated elapsed time over a precomputed
// cell template — no per-frame allocation churn.

const REVEAL_MS = 700
const GLINT_MS = 520
const GLINT_WIDTH = 4
const GLINT_STRENGTH = 0.9
const INTRO_MS = REVEAL_MS + GLINT_MS

const CYCLE_MS = 12000
const DISSOLVE_START = 6800
const DISSOLVE_MS = 1300
const HOLD_MS = 700
const REFORM_MS = 1300
const PARTICLE_CHANCE = 0.055
const GLYPH_MUTATE_MS = 70

const GRADIENT_END = 0.85
const REVEAL_SKEW = 0.6
const BREATHE_PERIOD = 5200
const BREATHE_MIX = 0.08
const GLOW_BREATHE_PERIOD = 9000
const TWINKLE_SLOT_MS = 1300
const TWINKLE_CHANCE = 0.03
const TWINKLE_MIX = 0.6
const WARM_WHITE = RGBA.fromInts(255, 250, 235)

const ART_W = Math.max(...big.map((row) => row.length))
const GLOW_W = 71
const ART_X = Math.floor((GLOW_W - ART_W) / 2)
const GLOW_TOP = -1
const ROWS = big.length + 3
export const HERO_W = GLOW_W
export const HERO_H = ROWS
const GLOW_CX = (GLOW_W - 1) / 2
const ART_CY = (big.length - 1) / 2
const SWEEP = GLOW_W + ROWS * REVEAL_SKEW + 8
const TAG_OFFSET = Math.floor((GLOW_W - tagline.length) / 2)

const GLYPHS = Array.from("01{}[]()<>/*+-=;$#@!&|^~:;λΣπμ→←↑↓░▒▓│┤")

const gauss = (x: number, center: number, sigma: number) => Math.exp(-((x - center) ** 2) / (2 * sigma * sigma))

const hash = (a: number, b: number, c: number) => {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

const easeOutCubic = (p: number) => 1 - (1 - p) ** 3

const easeInOut = (p: number) => p * p * (3 - 2 * p)

const glyphAt = (x: number, y: number, slot: number) => GLYPHS[Math.floor(hash(x, y, slot) * GLYPHS.length)] ?? " "

type Kind = "block" | "tag" | "glow"

type Cell = {
  x: number
  row: number
  y: number
  kind: Kind
  charCode: number
  threshold: number
}

const CELLS: Cell[] = []
for (let gy = 0; gy < ROWS; gy++) {
  const y = GLOW_TOP + gy
  const line = big[y] ?? ""
  const tagRow = y === big.length + 1
  for (let x = 0; x < GLOW_W; x++) {
    if (tagRow) {
      const char = tagline[x - TAG_OFFSET] ?? " "
      CELLS.push({
        x,
        row: gy,
        y,
        kind: char === " " ? "glow" : "tag",
        charCode: char.codePointAt(0) ?? 32,
        threshold: 0,
      })
      continue
    }
    const char = x >= ART_X && x - ART_X < line.length ? line[x - ART_X] : " "
    const block = char === "█"
    CELLS.push({
      x,
      row: gy,
      y,
      kind: block ? "block" : "glow",
      charCode: char.codePointAt(0) ?? 32,
      threshold: block ? ((x - ART_X) / (ART_W - 1)) * 0.75 + hash(x, y, 17) * 0.25 : 0,
    })
  }
}

export type HomeHeroThemeColors = {
  background: RGBA
  primary: RGBA
  text: RGBA
  textMuted: RGBA
}

function same(a: Rgb, b: Rgb) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

// The solid renderer stringifies certain JSX attribute values before they
// reach a renderable setter (see the "text"/"content" cases in opentui's
// setProperty). Guard the theme boundary so a malformed color degrades to the
// previous value instead of crashing the home screen.
function safeRgb(value: RGBA | undefined): Rgb | undefined {
  if (!value || typeof value.toInts !== "function") return undefined
  return toRgb(value)
}

function mix(a: Rgb, b: Rgb, alpha: number): Rgb {
  const t = clamp01(alpha)
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function write(buffer: Uint16Array, offset: number, color: Rgb) {
  buffer[offset] = color[0]
  buffer[offset + 1] = color[1]
  buffer[offset + 2] = color[2]
  buffer[offset + 3] = 255
}

type Phase = "solid" | "dissolve" | "hold" | "reform" | "glint"

function phaseOf(cycleT: number): { phase: Phase; progress: number } {
  if (cycleT < DISSOLVE_START) return { phase: "solid", progress: 0 }
  const dissolveEnd = DISSOLVE_START + DISSOLVE_MS
  if (cycleT < dissolveEnd) return { phase: "dissolve", progress: easeInOut((cycleT - DISSOLVE_START) / DISSOLVE_MS) }
  const holdEnd = dissolveEnd + HOLD_MS
  if (cycleT < holdEnd) return { phase: "hold", progress: 1 }
  const reformEnd = holdEnd + REFORM_MS
  if (cycleT < reformEnd) return { phase: "reform", progress: easeInOut((cycleT - holdEnd) / REFORM_MS) }
  return { phase: "glint", progress: (cycleT - reformEnd) / GLINT_MS }
}

export class HomeHeroPainter {
  private elapsed = 0
  private backgroundRgb: Rgb = [0, 0, 0]
  private primaryRgb: Rgb = [255, 255, 255]
  private textRgb: Rgb = [255, 255, 255]
  private mutedRgb: Rgb = [128, 128, 128]
  private warmRgb: Rgb = toRgb(WARM_WHITE)
  private columns: Rgb[] = []

  constructor() {
    this.refreshPalette()
  }

  setTheme(next: Partial<HomeHeroThemeColors>) {
    const background = safeRgb(next.background) ?? this.backgroundRgb
    const primary = safeRgb(next.primary) ?? this.primaryRgb
    const text = safeRgb(next.text) ?? this.textRgb
    const muted = safeRgb(next.textMuted) ?? this.mutedRgb
    const changed =
      !same(background, this.backgroundRgb) ||
      !same(primary, this.primaryRgb) ||
      !same(text, this.textRgb) ||
      !same(muted, this.mutedRgb)
    if (!changed) return false
    this.backgroundRgb = background
    this.primaryRgb = primary
    this.textRgb = text
    this.mutedRgb = muted
    this.refreshPalette()
    return true
  }

  private refreshPalette() {
    this.columns = Array.from({ length: ART_W }, (_, x) =>
      mix(this.primaryRgb, this.textRgb, (x / (ART_W - 1)) * GRADIENT_END),
    )
  }

  render(frameBuffer: OptimizedBuffer, options: { deltaTime?: number } = {}) {
    this.elapsed += options.deltaTime ?? 0
    const t = this.elapsed
    const intro = t < INTRO_MS
    const reveal = easeOutCubic(clamp01(t / REVEAL_MS))
    const cycleIndex = intro ? -1 : Math.floor((t - INTRO_MS) / CYCLE_MS)
    const cycleT = intro ? 0 : (t - INTRO_MS) % CYCLE_MS
    const { phase, progress } = intro ? { phase: "solid" as Phase, progress: 0 } : phaseOf(cycleT)
    const glintX = this.glintPosition(t, intro, cycleT, phase, progress)
    const glowBreathe = 0.92 + 0.08 * Math.sin((2 * Math.PI * t) / GLOW_BREATHE_PERIOD)
    const mutateSlot = Math.floor(t / GLYPH_MUTATE_MS)
    const buffers = frameBuffer.buffers
    const fg = buffers.fg
    const bg = buffers.bg
    const chars = buffers.char
    const attrs = buffers.attributes

    for (const cell of CELLS) {
      const index = cell.row * HERO_W + cell.x
      const offset = index * 4
      const falloff = Math.max(0, 1 - Math.abs(cell.y - ART_CY) / (ART_CY + 1.5))
      const glow = gauss(cell.x, GLOW_CX, 20) * falloff * 0.35 * reveal * glowBreathe
      const base = glow < 0.01 ? this.backgroundRgb : mix(this.backgroundRgb, this.primaryRgb, glow)
      write(fg, offset, base)
      write(bg, offset, base)
      attrs[index] = 0

      if (cell.kind === "glow") {
        chars[index] = 32
        this.drawParticle(buffers, cell, index, base, cycleIndex, mutateSlot)
        continue
      }

      const edge = clamp01(reveal * SWEEP - cell.x - cell.y * REVEAL_SKEW - 3)
      if (edge <= 0) {
        chars[index] = 32
        continue
      }

      if (cell.kind === "tag") {
        chars[index] = cell.charCode
        write(fg, offset, mix(base, this.mutedRgb, edge))
        continue
      }

      if (phase !== "solid" && this.dissolved(cell, phase, progress)) {
        const glyph = glyphAt(cell.x, cell.y, mutateSlot)
        chars[index] = glyph.codePointAt(0) ?? 32
        const shimmer = 0.2 + 0.45 * hash(cell.x, cell.y, mutateSlot + 1)
        write(fg, offset, mix(base, this.primaryRgb, shimmer * edge))
        continue
      }

      chars[index] = cell.charCode
      let color = this.columns[cell.x - ART_X] ?? this.textRgb
      const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / BREATHE_PERIOD - cell.x * 0.45 + cell.y * 0.2)
      color = mix(color, this.warmRgb, wave * BREATHE_MIX)
      const raw = 1 - Math.abs(cell.x + cell.y * 0.7 - glintX) / GLINT_WIDTH
      const glint = raw <= 0 ? 0 : raw * raw * (3 - 2 * raw) * GLINT_STRENGTH
      const slot = Math.floor(t / TWINKLE_SLOT_MS)
      const twinkle =
        hash(cell.x, cell.y, slot) < TWINKLE_CHANCE
          ? Math.sin(Math.PI * ((t % TWINKLE_SLOT_MS) / TWINKLE_SLOT_MS)) * TWINKLE_MIX
          : 0
      color = mix(color, this.warmRgb, clamp01(glint + twinkle))
      write(fg, offset, mix(base, color, edge))
      attrs[index] = TextAttributes.BOLD
    }
  }

  private dissolved(cell: Cell, phase: Phase, progress: number) {
    if (phase === "hold") return true
    if (phase === "dissolve") return progress > cell.threshold
    if (phase === "reform") return progress <= cell.threshold
    return false
  }

  private drawParticle(
    buffers: { char: Uint32Array; fg: Uint16Array },
    cell: Cell,
    index: number,
    base: Rgb,
    cycleIndex: number,
    mutateSlot: number,
  ) {
    if (cycleIndex < 0) return
    if (hash(cell.x, cell.y, cycleIndex * 31 + 5) >= PARTICLE_CHANCE) return
    const glyph = glyphAt(cell.x, cell.y, mutateSlot)
    buffers.char[index] = glyph.codePointAt(0) ?? 32
    write(buffers.fg, index * 4, mix(base, this.primaryRgb, 0.1 + 0.18 * hash(cell.x, cell.y, mutateSlot)))
  }

  private glintPosition(t: number, intro: boolean, cycleT: number, phase: Phase, progress: number) {
    if (intro) {
      const elapsed = t - REVEAL_MS
      if (elapsed <= 0) return Number.NEGATIVE_INFINITY
      return -6 + (elapsed / GLINT_MS) * (SWEEP + 6)
    }
    if (phase !== "glint") return Number.NEGATIVE_INFINITY
    const local = cycleT - (DISSOLVE_START + DISSOLVE_MS + HOLD_MS + REFORM_MS)
    if (progress >= 1) return Number.NEGATIVE_INFINITY
    return -6 + (local / GLINT_MS) * (SWEEP + 6)
  }
}
