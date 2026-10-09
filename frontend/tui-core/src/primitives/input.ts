import { Renderable, type PaintContext } from "../layout/engine"
import { graphemes, graphemeWidth, stringWidth } from "../text"
import { Attr } from "../types"
import type { KeyEvent } from "../types"
import type { TextSegment } from "./text"

export type InputStyleProps = {
  value?: string
  placeholder?: string
  maxLength?: number
  textColor?: string | number
  cursorColor?: string | number
  selectionColor?: string | number
  onInput?: (value: string) => void
}

// Single-line editable text. Selection is [anchor, cursor]; editing keys are
// delivered through the focus router (node.emit("key", event)). Horizontal
// scrolling keeps the cursor in view when the value exceeds the layout width.
export class InputRenderable extends Renderable {
  private raw = ""
  private caret = 0
  private anchor: number | undefined
  private scroll = 0
  placeholder = ""
  maxLength?: number
  cursorColor = 0x999999
  selectionColor = 0x333399
  onInput?: (value: string) => void

  constructor(props: InputStyleProps = {}) {
    super()
    if (props.value) this.raw = props.value
    if (props.placeholder !== undefined) this.placeholder = props.placeholder
    if (props.maxLength !== undefined) this.maxLength = props.maxLength
    if (props.textColor !== undefined) this.restyle({ fg: props.textColor })
    if (props.cursorColor !== undefined) this.cursorColor = Number(props.cursorColor)
    if (props.selectionColor !== undefined) this.selectionColor = Number(props.selectionColor)
    if (props.onInput) this.onInput = props.onInput
    this.caret = this.raw.length
    this.on("key", (event) => this.handleKey(event as KeyEvent))
  }

  get value(): string {
    return this.raw
  }

  set value(next: string) {
    this.raw = next
    this.caret = Math.min(this.caret, next.length)
    this.anchor = undefined
    this.scrollIntoView()
    this.markDirty()
  }

  get selectionStart(): number {
    if (this.anchor === undefined) return this.caret
    return Math.min(this.anchor, this.caret)
  }

  get selectionEnd(): number {
    if (this.anchor === undefined) return this.caret
    return Math.max(this.anchor, this.caret)
  }

  setCursor(index: number, extend = false): void {
    const next = Math.max(0, Math.min(index, this.raw.length))
    if (extend) this.anchor = this.anchor ?? this.caret
    else this.anchor = undefined
    this.caret = next
    this.scrollIntoView()
    this.markDirty()
  }

  handleKey(event: KeyEvent): boolean {
    if (event.ctrl || event.meta) return this.handleControl(event)
    switch (event.name) {
      case "left":
        this.setCursor(this.anchor !== undefined ? this.selectionStart : this.caret - 1)
        return true
      case "right":
        this.setCursor(this.anchor !== undefined ? this.selectionEnd : this.caret + 1)
        return true
      case "home":
        this.setCursor(0)
        return true
      case "end":
        this.setCursor(this.raw.length)
        return true
      case "backspace":
        this.deleteBackward()
        return true
      case "delete":
        this.deleteForward()
        return true
      case "enter":
      case "return":
        this.commit()
        return true
      case "escape":
        this.anchor = undefined
        this.markDirty()
        return true
      default:
        if (event.name.length === 1 && !event.ctrl && !event.alt) {
          this.insert(event.name)
          return true
        }
        return false
    }
  }

  private handleControl(event: KeyEvent): boolean {
    if (!event.ctrl) return false
    switch (event.name) {
      case "a":
        this.setCursor(0)
        return true
      case "e":
        this.setCursor(this.raw.length)
        return true
      case "u":
        this.replaceRange(0, this.caret, "")
        this.notify()
        return true
      case "k":
        this.replaceRange(this.caret, this.raw.length, "")
        this.notify()
        return true
      case "w": {
        const start = this.wordStart()
        this.replaceRange(start, this.caret, "")
        this.notify()
        return true
      }
      default:
        return false
    }
  }

  insert(text: string): void {
    const cleaned = text.replace(/[\r\n].*$/s, "").replace(/[\u0000-\u001f\u007f]/g, "")
    if (!cleaned.length && text.length) return
    if (this.maxLength !== undefined) {
      const room = Math.max(0, this.maxLength - (this.raw.length - (this.selectionEnd - this.selectionStart)))
      const limited = truncateTo(cleaned, room)
      this.replaceRange(this.selectionStart, this.selectionEnd, limited)
    } else {
      this.replaceRange(this.selectionStart, this.selectionEnd, cleaned)
    }
    this.notify()
  }

  deleteBackward(): void {
    if (this.anchor !== undefined) {
      this.replaceRange(this.selectionStart, this.selectionEnd, "")
    } else if (this.caret > 0) {
      const parts = graphemes(this.raw.slice(0, this.caret))
      const step = Math.max(1, parts[parts.length - 1]?.length ?? 1)
      this.replaceRange(this.caret - step, this.caret, "")
    } else return
    this.notify()
  }

  deleteForward(): void {
    if (this.anchor !== undefined) {
      this.replaceRange(this.selectionStart, this.selectionEnd, "")
    } else if (this.caret < this.raw.length) {
      const rest = graphemes(this.raw.slice(this.caret))
      const step = Math.max(1, rest[0]?.length ?? 1)
      this.replaceRange(this.caret, this.caret + step, "")
    } else return
    this.notify()
  }

  private wordStart(): number {
    const before = this.raw.slice(0, this.caret)
    const match = /\S+\s*$/.exec(before)
    return match ? match.index : this.caret
  }

  private replaceRange(start: number, end: number, text: string): void {
    this.raw = this.raw.slice(0, start) + text + this.raw.slice(end)
    this.caret = start + text.length
    this.anchor = undefined
    this.scrollIntoView()
    this.markDirty()
  }

  private notify(): void {
    this.onInput?.(this.raw)
  }

  // Hook for hosts (dialogs) that close/commit on Enter.
  commit(): void {}

  private scrollIntoView(): void {
    const width = this.layoutRect.width || 1
    const caretWidth = stringWidth(this.raw.slice(0, this.caret))
    if (caretWidth < this.scroll + 1) this.scroll = Math.max(0, caretWidth - 1)
    else if (caretWidth > this.scroll + width - 2) this.scroll = caretWidth - width + 2
  }

  override paint(ctx: PaintContext): void {
    const { buffer, clip } = ctx
    const r = this.layoutRect
    const y = r.y
    const showPlaceholder = this.raw.length === 0 && this.placeholder.length > 0 && this.anchor === undefined
    const source = showPlaceholder ? this.placeholder : this.raw
    const fg = showPlaceholder ? -1 : this.fg
    const segments = this.displaySegments(source, fg)
    let cursorColumn = stringWidth(showPlaceholder ? "" : source.slice(0, this.caret))
    let x = r.x
    let visibleWidth = 0
    for (const segment of segments) {
      for (const grapheme of graphemes(segment.text)) {
        const gw = graphemeWidth(grapheme)
        const column = visibleWidth
        visibleWidth += gw
        if (column < this.scroll) continue
        if (x >= r.x + r.width) break
        const selected = this.selectionStart <= this.raw.length && this.anchor !== undefined && inSelection(this, source, column)
        const isCursor = !showPlaceholder && column === cursorColumn && this.focused
        const cellFg = isCursor ? this.cursorColor : segment.fg === -1 ? this.fg : segment.fg
        const cellBg = selected ? this.selectionColor : segment.bg === -1 ? this.bg : segment.bg
        if (x >= clip.x && x < clip.x + clip.width && y >= clip.y && y < clip.y + clip.height) {
          buffer.setChar(x, y, grapheme, cellFg, cellBg, selected || isCursor ? Attr.Inverse : segment.attrs)
        }
        x += gw
      }
    }
    for (; x < r.x + r.width; x++) {
      if (x >= clip.x && x < clip.x + clip.width && y >= clip.y && y < clip.y + clip.height) {
        buffer.setChar(x, y, " ", this.fg, this.bg, Attr.None)
      }
    }
    void cursorColumn
  }

  private displaySegments(source: string, fg: number): TextSegment[] {
    return [{ text: source, fg, bg: this.bg, attrs: Attr.None }]
  }
}

function inSelection(input: InputRenderable, _source: string, column: number): boolean {
  if (input.anchor === undefined) return false
  const from = graphemeColumn(input.value, input.selectionStart)
  const to = graphemeColumn(input.value, input.selectionEnd)
  return column >= from && column < to
}

function graphemeColumn(text: string, index: number): number {
  let width = 0
  for (const grapheme of graphemes(text.slice(0, index))) width += graphemeWidth(grapheme)
  return width
}

function truncateTo(text: string, budget: number): string {
  if (budget <= 0) return ""
  let acc = 0
  let out = ""
  for (const grapheme of graphemes(text)) {
    const w = graphemeWidth(grapheme)
    if (acc + w > budget) break
    out += grapheme
    acc += w
  }
  return out
}
