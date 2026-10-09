import { graphemes, graphemeWidth } from "../text"

export type VisualLine = Readonly<{
  start: number
  end: number
  width: number
}>

type Cluster = Readonly<{ text: string; offset: number; width: number; space: boolean }>

function clusters(text: string, base: number): Cluster[] {
  const out: Cluster[] = []
  let acc = 0
  for (const grapheme of graphemes(text)) {
    out.push({ text: grapheme, offset: base + acc, width: graphemeWidth(grapheme), space: /\s/.test(grapheme) })
    acc += grapheme.length
  }
  return out
}

// Word-wrap logical lines into viewport-width visual lines. Ranges stay
// contiguous: on overflow the line breaks after the last space inside the
// row (words longer than the row hard-split). Leading spaces of a wrapped
// continuation belong to the previous line.
export function computeVisualLines(text: string, width: number): VisualLine[] {
  const lines: VisualLine[] = []
  if (width <= 0) return [{ start: 0, end: text.length, width: 0 }]
  const push = (start: number, end: number, source: string, base: number) => {
    let w = 0
    for (const g of graphemes(source.slice(start - base, end - base))) w += graphemeWidth(g)
    lines.push({ start, end, width: w })
  }
  let base = 0
  for (const logical of text.split("\n")) {
    const items = clusters(logical, base)
    let lineStart = 0
    let lineWidth = 0
    let lastSpace = -1
    let index = 0
    for (const item of items) {
      if (lineWidth + item.width > width && lineWidth > 0) {
        const breakAt = lastSpace >= lineStart && lastSpace > lineStart ? lastSpace + 1 : index
        push(base + lineStart, base + breakAt, logical, base)
        let carried = 0
        for (let i = breakAt; i < index; i++) carried += items[i]!.width
        lineStart = breakAt
        lineWidth = carried + item.width
        lastSpace = -1
      } else {
        lineWidth += item.width
      }
      if (item.space) lastSpace = index
      index += item.text.length
    }
    push(base + lineStart, base + logical.length, logical, base)
    base += logical.length + 1
  }
  if (!lines.length) lines.push({ start: 0, end: 0, width: 0 })
  return lines
}

export class EditorView {
  private source = ""

  constructor(private lines: VisualLine[]) {}

  setSource(text: string): void {
    this.source = text
  }

  get count(): number {
    return this.lines.length
  }

  getTotalVirtualLineCount(): number {
    return this.lines.length
  }

  line(index: number): VisualLine | undefined {
    return this.lines[index]
  }

  positionOf(offset: number): Readonly<{ row: number; col: number }> {
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i]!
      if (offset < line.end || i === this.lines.length - 1) {
        if (offset <= line.start) return { row: i, col: 0 }
        let col = 0
        for (const grapheme of graphemes(this.source.slice(line.start, offset))) col += graphemeWidth(grapheme)
        return { row: i, col: Math.min(col, line.width) }
      }
    }
    return { row: 0, col: 0 }
  }

  offsetOf(row: number, col: number): number {
    const line = this.lines[Math.max(0, Math.min(row, this.lines.length - 1))]
    if (!line) return 0
    let acc = 0
    for (const grapheme of graphemes(this.source.slice(line.start, line.end))) {
      if (acc >= col) return line.start + acc
      acc += graphemeWidth(grapheme)
    }
    return line.end
  }

  // Move by visual rows keeping the column as close as possible.
  moveVisual(from: number, deltaRows: number): number {
    const { row, col } = this.positionOf(from)
    const target = this.lines[Math.max(0, Math.min(row + deltaRows, this.lines.length - 1))]
    if (!target) return from
    let acc = 0
    for (const grapheme of graphemes(this.source.slice(target.start, target.end))) {
      const gw = graphemeWidth(grapheme)
      if (acc + gw > col) return target.start + acc
      acc += gw
    }
    return target.end
  }
}
