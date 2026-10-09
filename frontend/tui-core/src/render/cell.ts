import { Attr, type Attributes } from "../types"
import { graphemeWidth } from "../text"

export const NO_COLOR = -1

export type Cell = Readonly<{
  text: string
  fg: number
  bg: number
  attrs: Attributes
}>

export const BLANK_CELL: Cell = { text: " ", fg: NO_COLOR, bg: NO_COLOR, attrs: Attr.None }
export const CONTINUATION_CELL: Cell = { text: "", fg: NO_COLOR, bg: NO_COLOR, attrs: Attr.None }

export class CellBuffer {
  readonly width: number
  readonly height: number
  readonly cells: Cell[]

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.cells = new Array(width * height)
    this.clear()
  }

  index(x: number, y: number): number {
    return y * this.width + x
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  clear(): void {
    this.cells.fill(BLANK_CELL)
  }

  get(x: number, y: number): Cell | undefined {
    if (!this.inBounds(x, y)) return undefined
    return this.cells[this.index(x, y)]
  }

  set(x: number, y: number, c: Cell): void {
    if (!this.inBounds(x, y)) return
    this.cells[this.index(x, y)] = c
  }

  setChar(x: number, y: number, text: string, fg: number, bg: number, attrs: Attributes): void {
    this.set(x, y, { text, fg, bg, attrs })
    const w = graphemeWidth(text)
    if (w > 1) {
      for (let i = 1; i < w; i++) this.set(x + i, y, { text: "", fg, bg, attrs })
    } else if (this.get(x + 1, y)?.text === "") {
      this.set(x + 1, y, BLANK_CELL)
    }
  }

  fillRect(x: number, y: number, w: number, h: number, bg: number): void {
    if (bg === NO_COLOR) return
    const c: Cell = { text: " ", fg: NO_COLOR, bg, attrs: Attr.None }
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) this.set(col, row, c)
  }

  copyFrom(other: CellBuffer): void {
    for (let i = 0; i < this.cells.length && i < other.cells.length; i++) this.cells[i] = other.cells[i]
  }

  line(y: number): string {
    let out = ""
    for (let x = 0; x < this.width; x++) out += cellText(this.cells[this.index(x, y)])
    return out.replace(/\s+$/, "")
  }

  charFrame(): string {
    const lines: string[] = []
    for (let y = 0; y < this.height; y++) lines.push(this.line(y))
    return lines.join("\n")
  }
}

export function cellText(c: Cell | undefined): string {
  if (!c || c.text === undefined) return " "
  return c.text === "" ? "" : c.text
}

export function sameCell(a: Cell | undefined, b: Cell | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.text === b.text && a.fg === b.fg && a.bg === b.bg && a.attrs === b.attrs
}
