import { type Cell, type CellBuffer, NO_COLOR, sameCell } from "./cell"
import { Attr, type Attributes } from "../types"

export type Run = Readonly<{
  x: number
  y: number
  text: string
  fg: number
  bg: number
  attrs: Attributes
}>

export function diffBuffers(prev: CellBuffer | undefined, next: CellBuffer): Run[] {
  const runs: Run[] = []
  const canReuse = prev !== undefined && prev.width === next.width && prev.height === next.height
  for (let y = 0; y < next.height; y++) {
    let x = 0
    while (x < next.width) {
      const c = next.cells[y * next.width + x]
      if (canReuse && sameCell(prev!.cells[y * next.width + x], c)) {
        x += Math.max(1, displayWidth(c))
        continue
      }
      const start = x
      let text = ""
      while (x < next.width) {
        const cur = next.cells[y * next.width + x]
        if (x > start) {
          if (!sameStyle(cur, next.cells[y * next.width + start])) break
          if (canReuse && sameCell(prev!.cells[y * next.width + x], cur)) break
        }
        if (cur.text !== "") text += cur.text
        x += Math.max(1, displayWidth(cur))
      }
      runs.push({ x: start, y, text, fg: c.fg, bg: c.bg, attrs: c.attrs })
    }
  }
  return runs
}

function sameStyle(a: Cell, b: Cell): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.attrs === b.attrs
}

function displayWidth(c: Cell): number {
  if (c.text === "") return 1
  let w = 0
  for (const ch of c.text) w += ch.codePointAt(0)! >= 0x1100 && ch.codePointAt(0)! <= 0x115f ? 2 : 1
  return Math.max(1, w)
}

export function emitRuns(runs: Run[]): string {
  let out = ""
  let curFg = NO_COLOR
  let curBg = NO_COLOR
  let curAttrs: Attributes = Attr.None
  for (const run of runs) {
    if (!run.text.length) continue
    out += `\x1b[${run.y + 1};${run.x + 1}H`
    const sgr = sgrDelta({ fg: curFg, bg: curBg, attrs: curAttrs }, { fg: run.fg, bg: run.bg, attrs: run.attrs })
    if (sgr) out += sgr
    curFg = run.fg
    curBg = run.bg
    curAttrs = run.attrs
    out += run.text
  }
  if (out) out += "\x1b[0m"
  return out
}

export function sgrDelta(from: { fg: number; bg: number; attrs: Attributes }, to: { fg: number; bg: number; attrs: Attributes }): string {
  const codes: number[] = []
  const attrBits = to.attrs & ~Attr.Hidden
  if (attrBits !== (from.attrs & ~Attr.Hidden)) {
    codes.push(0)
    if (attrBits & Attr.Bold) codes.push(1)
    if (attrBits & Attr.Dim) codes.push(2)
    if (attrBits & Attr.Italic) codes.push(3)
    if (attrBits & Attr.Underline) codes.push(4)
    if (attrBits & Attr.Blink) codes.push(5)
    if (attrBits & Attr.Inverse) codes.push(7)
    if (attrBits & Attr.Strike) codes.push(9)
    if (to.attrs & Attr.Hidden) codes.push(8)
  }
  if (to.fg !== from.fg) {
    if (to.fg === NO_COLOR) codes.push(39)
    else codes.push(38, 2, (to.fg >> 16) & 0xff, (to.fg >> 8) & 0xff, to.fg & 0xff)
  }
  if (to.bg !== from.bg) {
    if (to.bg === NO_COLOR) codes.push(49)
    else codes.push(48, 2, (to.bg >> 16) & 0xff, (to.bg >> 8) & 0xff, to.bg & 0xff)
  }
  if (!codes.length) return ""
  return `\x1b[${codes.join(";")}m`
}

export function fullFrame(buffer: CellBuffer): string {
  let out = "\x1b[H\x1b[2J"
  let curFg = NO_COLOR
  let curBg = NO_COLOR
  let curAttrs: Attributes = Attr.None
  for (let y = 0; y < buffer.height; y++) {
    let x = 0
    while (x < buffer.width) {
      const c = buffer.cells[y * buffer.width + x]
      if (c.text === "") {
        x++
        continue
      }
      const isDefault =
        c.text === " " && c.fg === NO_COLOR && c.bg === NO_COLOR && (c.attrs & ~Attr.None) === 0
      if (isDefault && curFg === NO_COLOR && curBg === NO_COLOR && curAttrs === Attr.None) {
        x += Math.max(1, displayWidth(c))
        continue
      }
      const sgr = sgrDelta({ fg: curFg, bg: curBg, attrs: curAttrs }, c)
      if (sgr) {
        out += `\x1b[${y + 1};${x + 1}H` + sgr
        curFg = c.fg
        curBg = c.bg
        curAttrs = c.attrs
      }
      out += c.text
      x += Math.max(1, displayWidth(c))
      if (x < buffer.width) out += `\x1b[${y + 1};${x + 1}H`
    }
  }
  return out + "\x1b[0m"
}
