import { Renderable, type PaintContext } from "../layout/engine"
import { stringWidth, graphemes, graphemeWidth } from "../text"
import { Attr } from "../types"
import type { WrapMode, TextStyleProps } from "../types"

export type TextSegment = Readonly<{ text: string; fg: number; bg: number; attrs: number }>

type Placed = Readonly<{ grapheme: string; segment: TextSegment }>

export class TextNodeRenderable extends Renderable {
  value = ""
  constructor(value: string) {
    super()
    this.value = value
    this.measurable = true
  }

  override markDirty(): void {
    super.markDirty()
  }

  measure(): Readonly<{ width: number; height: number }> {
    return { width: Math.max(1, stringWidth(this.value)), height: 1 }
  }

  override paint(ctx: PaintContext): void {
    const { buffer, clip } = ctx
    const r = this.layoutRect
    let x = r.x
    for (const grapheme of graphemes(this.value)) {
      const gw = graphemeWidth(grapheme)
      if (x >= clip.x && x < clip.x + clip.width && r.y >= clip.y && r.y < clip.y + clip.height) {
        buffer.setChar(x, r.y, grapheme, this.fg, this.bg, 0)
      }
      x += gw
      if (x >= r.x + r.width) break
    }
  }
}

export class SpanRenderable extends Renderable {
  attrs: number = Attr.None

  constructor(style?: TextStyleProps) {
    super(style)
    this.measurable = true
  }

  get text(): string {
    return inlineText(this.children)
  }

  measure(): Readonly<{ width: number; height: number }> {
    const lines = this.text.split("\n")
    return { width: Math.max(1, ...lines.map((l) => stringWidth(l))), height: lines.length }
  }

  override paint(ctx: PaintContext): void {
    // Spans are inline runs painted by their TextRenderable host; standalone
    // spans render as plain lines for tolerance.
    const { buffer, clip } = ctx
    const r = this.layoutRect
    const segments = collectSegments(this.children, { fg: this.fg, bg: this.bg, attrs: this.attrs })
    let x = r.x
    let y = r.y
    for (const segment of segments) {
      for (const grapheme of graphemes(segment.text)) {
        if (grapheme === "\n") {
          x = r.x
          y++
          continue
        }
        if (x >= clip.x && x < clip.x + clip.width && y >= clip.y && y < clip.y + clip.height) {
          buffer.setChar(x, y, grapheme, segment.fg, segment.bg, segment.attrs)
        }
        x += graphemeWidth(grapheme)
      }
    }
  }
}

export class TextRenderable extends Renderable {
  private segments: TextSegment[] = []
  wrap: WrapMode = "word"
  align: "left" | "center" | "right" = "left"

  constructor(style?: TextStyleProps) {
    super(style)
    this.measurable = true
    if (style) this.setStyledText(style)
  }

  setStyledText(style: TextStyleProps): void {
    if (style.wrap !== undefined) this.wrap = style.wrap
    if (style.textAlign !== undefined) this.align = style.textAlign
    if (style.content !== undefined) this.content = style.content
  }

  set content(value: string | TextSegment | readonly (string | TextSegment)[]) {
    this.segments = normalize(value, this.fg, this.bg)
    this.markDirty()
  }

  get content(): string {
    if (this.children.length) return inlineText(this.children)
    return this.segments.map((s) => s.text).join("")
  }

  private currentSegments(): TextSegment[] {
    if (!this.children.length) return this.segments
    return collectSegments(this.children, { fg: this.fg, bg: this.bg, attrs: 0 })
  }

  private place(width: number): Placed[][] {
    const segments = this.currentSegments()
    const lines: Placed[][] = []
    let current: Placed[] = []
    let lineWidth = 0
    const push = () => {
      lines.push(current)
      current = []
      lineWidth = 0
    }
    for (const segment of segments) {
      const parts = segment.text.split("\n")
      for (let p = 0; p < parts.length; p++) {
        if (p > 0) push()
        for (const grapheme of graphemes(parts[p])) {
          const gw = graphemeWidth(grapheme)
          if (this.wrap !== "none" && lineWidth + gw > width && lineWidth > 0) push()
          if (lineWidth + gw > width && this.wrap === "none") break
          current.push({ grapheme, segment })
          lineWidth += gw
        }
      }
    }
    push()
    if (this.wrap === "word") return wordWrapPlace(lines, width)
    return lines.length ? lines : [[]]
  }

  standaloneSegments(): TextSegment[] {
    if (this.children.length) return collectSegments(this.children, { fg: this.fg, bg: this.bg, attrs: 0 })
    return this.segments.map((seg) => ({
      ...seg,
      fg: seg.fg === -1 ? this.fg : seg.fg,
      bg: seg.bg === -1 ? this.bg : seg.bg,
    }))
  }

  measure(availableWidth: number): Readonly<{ width: number; height: number }> {
    const fixed = typeof this.style.width === "number" ? this.style.width : undefined
    const avail = fixed ?? (Number.isFinite(availableWidth) && availableWidth > 0 ? Math.floor(availableWidth) : 1e6)
    if (this.wrap === "none") {
      const width = stringWidth(this.content)
      return { width: Math.max(1, fixed ?? width), height: 1 }
    }
    const placed = this.place(avail)
    let max = 0
    for (const line of placed) {
      const w = line.reduce((a, p) => a + graphemeWidth(p.grapheme), 0)
      if (w > max) max = w
    }
    return { width: Math.max(1, fixed ?? max), height: Math.max(1, placed.length) }
  }

  override paint(ctx: PaintContext): void {
    const { buffer, clip } = ctx
    const r = this.layoutRect
    const placed = this.place(Math.max(1, r.width))
    for (let y = 0; y < r.height && y < placed.length; y++) {
      const row = placed[y]
      const rowWidth = row.reduce((a, p) => a + graphemeWidth(p.grapheme), 0)
      let offset = r.x
      if (rowWidth < r.width) {
        const fill = r.width - rowWidth
        if (this.align === "center") offset += Math.floor(fill / 2)
        else if (this.align === "right") offset += fill
      }
      let x = offset
      for (const p of row) {
        const gw = graphemeWidth(p.grapheme)
        const fg = p.segment.fg === -1 ? this.fg : p.segment.fg
        const bg = p.segment.bg === -1 ? this.bg : p.segment.bg
        if (x >= clip.x && x < clip.x + clip.width && r.y + y >= clip.y && r.y + y < clip.y + clip.height) {
          buffer.setChar(x, r.y + y, p.grapheme, fg, bg, p.segment.attrs)
        }
        x += gw
      }
    }
  }
}

function normalize(
  value: string | TextSegment | readonly (string | TextSegment)[],
  inheritFg: number,
  inheritBg: number,
): TextSegment[] {
  if (typeof value === "string") return [{ text: value, fg: inheritFg, bg: inheritBg, attrs: Attr.None }]
  if (Array.isArray(value)) {
    const out: TextSegment[] = []
    for (const part of value as readonly (string | TextSegment)[]) out.push(...normalize(part, inheritFg, inheritBg))
    return out
  }
  return [value as TextSegment]
}

export function inlineText(nodes: readonly Renderable[]): string {
  let out = ""
  for (const node of nodes) {
    if (node instanceof TextNodeRenderable) out += node.value
    else if (node instanceof SpanRenderable) out += node.text
    else if (node instanceof TextRenderable) out += node.content
  }
  return out
}

function collectSegments(
  nodes: readonly Renderable[],
  inherit: Readonly<{ fg: number; bg: number; attrs: number }>,
): TextSegment[] {
  const out: TextSegment[] = []
  for (const node of nodes) {
    if (node instanceof TextNodeRenderable) {
      out.push({ text: node.value, fg: node.fg !== -1 ? node.fg : inherit.fg, bg: inherit.bg, attrs: inherit.attrs })
      continue
    }
    if (node instanceof SpanRenderable) {
      const nextInherit = { fg: node.fg !== -1 ? node.fg : inherit.fg, bg: node.bg !== -1 ? node.bg : inherit.bg, attrs: node.attrs | inherit.attrs }
      out.push(...collectSegments(node.children, nextInherit))
      continue
    }
    if (node instanceof TextRenderable) out.push(...node.standaloneSegments())
  }
  return out
}

export function wordWrapPlace(lines: Placed[][], width: number): Placed[][] {
  const out: Placed[][] = []
  for (const line of lines) {
    const wrapped: Placed[] = []
    let lineWidth = 0
    let word: Placed[] = []
    let wordWidth = 0
    const flushWord = () => {
      if (!word.length) return
      if (lineWidth + wordWidth > width && lineWidth > 0) {
        out.push(wrapped)
        wrapped.splice(0, wrapped.length, ...word)
        lineWidth = wordWidth
      } else {
        wrapped.push(...word)
        lineWidth += wordWidth
      }
      word = []
      wordWidth = 0
    }
    for (const p of line) {
      const gw = graphemeWidth(p.grapheme)
      if (/^\s$/.test(p.grapheme)) {
        flushWord()
        if (lineWidth + gw > width) {
          out.push(wrapped)
          wrapped.splice(0, wrapped.length)
          lineWidth = 0
        }
        wrapped.push(p)
        lineWidth += gw
        continue
      }
      word.push(p)
      wordWidth += gw
      if (wordWidth > width) flushWord()
    }
    flushWord()
    out.push(wrapped)
  }
  return out.length ? out : [[]]
}

