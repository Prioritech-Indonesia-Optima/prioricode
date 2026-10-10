import { Renderable, type PaintContext } from "../layout/engine"
import { EditBuffer, type ExtmarkHandle } from "../text/edit-buffer"
import { EditorView, computeVisualLines } from "../text/editor-view"
import { graphemes, graphemeWidth, stringWidth } from "../text"
import { Attr, type KeyEvent } from "../types"

export type EditorTraits = Readonly<{
  capture?: readonly ("escape" | "navigate" | "submit" | "tab" | string)[]
  status?: string
  owner?: string
  role?: string
}>

export type PastePayload = Readonly<{ text: string; bytes: Uint8Array; preventDefault(): void }>

export type TextareaStyleProps = {
  value?: string
  placeholder?: string
  placeholderColor?: string | number
  textColor?: string | number
  focusedTextColor?: string | number
  cursorColor?: string | number
  selectionColor?: string | number
  minHeight?: number
  maxHeight?: number
  traits?: EditorTraits
  onContentChange?: () => void
  onCursorChange?: () => void
  onSubmit?: () => void
  onPaste?: (event: PastePayload) => void | Promise<void>
}

// Multi-line editor matching the surface the prompt relies on: plainText,
// cursorOffset, visualCursor, scrollY, extmarks (chips as anchored ranges),
// insertText/setText/clear/gotoBufferEnd/trim, focus-driven key handling,
// and a terminal cursor position the renderer exposes each frame.
export class TextareaRenderable extends Renderable {
  readonly buffer = new EditBuffer()
  private view = new EditorView([])
  private viewWidth = 0
  placeholder = ""
  placeholderColor = 0x777777
  focusedTextColor?: number
  cursorColor = 0xffffff
  selectionColor = 0x334488
  minHeight = 1
  maxHeight = Number.MAX_SAFE_INTEGER
  traits: EditorTraits = {}
  isDestroyed = false
  onContentChange?: () => void
  onCursorChange?: () => void
  onSubmit?: () => void
  onPaste?: (event: PastePayload) => void | Promise<void>
  styleForId?: (styleId: number | undefined) => Readonly<{ fg?: number; bg?: number; attrs?: number } | undefined>
  cursorPosition: Readonly<{ x: number; y: number }> | undefined

  constructor(props: TextareaStyleProps = {}) {
    super()
    this.measurable = true
    if (props.value !== undefined) this.buffer.text = props.value
    if (props.placeholder !== undefined) this.placeholder = props.placeholder
    if (props.placeholderColor !== undefined) this.placeholderColor = Number(props.placeholderColor)
    if (props.textColor !== undefined) this.restyle({ fg: props.textColor })
    if (props.focusedTextColor !== undefined) this.focusedTextColor = Number(props.focusedTextColor)
    if (props.cursorColor !== undefined) this.cursorColor = Number(props.cursorColor)
    if (props.selectionColor !== undefined) this.selectionColor = Number(props.selectionColor)
    if (props.minHeight !== undefined) this.minHeight = props.minHeight
    if (props.maxHeight !== undefined) this.maxHeight = props.maxHeight
    if (props.traits) this.traits = props.traits
    this.onContentChange = props.onContentChange
    this.onCursorChange = props.onCursorChange
    this.onSubmit = props.onSubmit
    this.onPaste = props.onPaste
    this.buffer.onChange = () => {
      this.onContentChange?.()
      this.markDirty()
    }
    this.on("key", (event) => this.handleKey(event as unknown as KeyEvent))
    this.on("paste", (event) => void this.handlePaste(event as unknown as PastePayload))
  }

  get extmarks() {
    return this.buffer
  }

  get plainText(): string {
    return this.buffer.text
  }

  get text(): string {
    return this.buffer.text
  }

  get cursorOffset(): number {
    return this.buffer.cursor
  }

  set cursorOffset(next: number) {
    this.buffer.setCursor(next)
    this.afterCursorMove()
  }

  get visualCursor(): Readonly<{ offset: number; visualRow: number; col: number }> {
    this.ensureView()
    const position = this.view.positionOf(this.buffer.cursor)
    return { offset: this.buffer.cursor, visualRow: position.row, col: position.col }
  }

  get editorView(): EditorView {
    this.ensureView()
    return this.view
  }

  get scrollY(): number {
    return this._scrollY
  }

  set scrollY(next: number) {
    this._scrollY = Math.max(0, Math.min(Math.round(next), Math.max(0, this.view.count - 1)))
    this.markDirty()
  }

  private _scrollY = 0

  setText(text: string): void {
    this.buffer.setText(text)
    this.afterCursorMove()
  }

  insertText(text: string): void {
    this.buffer.insert(text.replace(/\r\n?/g, "\n"))
    this.afterCursorMove()
  }

  clear(): void {
    this.buffer.setText("")
    this.afterCursorMove()
  }

  trim(): void {
    this.buffer.setText(this.buffer.text.trim())
    this.afterCursorMove()
  }

  gotoBufferEnd(): void {
    this.buffer.setCursor(this.buffer.text.length)
    this.afterCursorMove()
  }

  getLayoutNode(): Readonly<{ markDirty: () => void }> {
    return { markDirty: () => this.markDirty() }
  }

  destroy(): void {
    this.isDestroyed = true
  }

  measure(availableWidth: number): Readonly<{ width: number; height: number }> {
    const width =
      Number.isFinite(availableWidth) && availableWidth > 0 ? Math.floor(availableWidth) : this.layoutRect.width || 80
    void stringWidth
    const rows = computeVisualLines(this.buffer.text || this.placeholder, width).length
    return { width: Math.max(1, width), height: Math.max(this.minHeight, Math.min(this.maxHeight, rows)) }
  }

  private capture(name: string): boolean {
    const capture = this.traits.capture ?? []
    if (capture.includes(name)) return true
    if (name === "enter" && capture.includes("submit")) return true
    if (
      ["left", "right", "up", "down", "home", "end", "pageUp", "pageDown"].includes(name) &&
      capture.includes("navigate")
    )
      return true
    return false
  }

  handleKey(event: KeyEvent): boolean {
    if (this.capture(event.name)) return false
    if (event.ctrl || event.meta) return this.handleControl(event)
    switch (event.name) {
      case "left":
        this.move(this.buffer.anchor !== undefined ? this.buffer.selectionStart : this.buffer.cursor - 1, event.shift)
        return true
      case "right":
        this.move(this.buffer.anchor !== undefined ? this.buffer.selectionEnd : this.buffer.cursor + 1, event.shift)
        return true
      case "up":
        this.ensureView()
        this.move(this.view.moveVisual(this.buffer.cursor, -1), event.shift)
        return true
      case "down":
        this.ensureView()
        this.move(this.view.moveVisual(this.buffer.cursor, 1), event.shift)
        return true
      case "home":
        this.move(this.buffer.lineBounds().start, event.shift)
        return true
      case "end":
        this.move(this.buffer.lineBounds().end, event.shift)
        return true
      case "backspace":
        this.buffer.deleteBackward()
        this.afterCursorMove()
        return true
      case "delete":
        this.buffer.deleteForward()
        this.afterCursorMove()
        return true
      case "enter":
        if (this.onSubmit) this.onSubmit()
        else this.insertText("\n")
        return true
      case "tab":
        this.insertText("    ")
        return true
      case "escape":
        return false
      default:
        if (event.name.length === 1) {
          this.insertText(event.name)
          return true
        }
        return false
    }
  }

  private handleControl(event: KeyEvent): boolean {
    if (!event.ctrl) return false
    switch (event.name) {
      case "a":
        this.move(this.buffer.lineBounds().start)
        return true
      case "e":
        this.move(this.buffer.lineBounds().end)
        return true
      case "u":
        if (this.buffer.hasSelection) this.buffer.deleteRange(this.buffer.selectionStart, this.buffer.selectionEnd)
        else this.buffer.deleteRange(this.buffer.lineBounds().start, this.buffer.cursor)
        this.afterCursorMove()
        return true
      case "k":
        this.buffer.deleteRange(this.buffer.cursor, this.buffer.lineBounds().end)
        this.afterCursorMove()
        return true
      case "w": {
        const bounds = this.buffer.lineBounds()
        const before = this.buffer.text.slice(0, this.buffer.cursor)
        const match = /\S+\s*$/.exec(before.slice(bounds.start))
        const start = match ? bounds.start + match.index : this.buffer.cursor
        this.buffer.deleteRange(start, this.buffer.cursor)
        this.afterCursorMove()
        return true
      }
      default:
        return false
    }
  }

  pasteText(text: string): void {
    void this.handlePaste({
      text,
      bytes: new TextEncoder().encode(text),
      preventDefault: () => {},
    })
  }

  async handlePaste(event: PastePayload): Promise<boolean> {
    let prevented = false
    const payload: PastePayload = Object.assign({}, event, {
      preventDefault: () => {
        prevented = true
      },
    })
    if (this.onPaste) {
      await this.onPaste(payload)
      if (prevented) return true
    }
    const cleaned = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    if (cleaned) this.insertText(cleaned)
    return true
  }

  private move(next: number, extend = false): void {
    this.buffer.setCursor(next, extend)
    this.afterCursorMove()
  }

  private afterCursorMove(): void {
    this.ensureView()
    const { row } = this.view.positionOf(this.buffer.cursor)
    const height = this.layoutRect.height || this.minHeight
    if (row < this._scrollY) this._scrollY = row
    else if (row >= this._scrollY + height) this._scrollY = row - height + 1
    this.onCursorChange?.()
    this.markDirty()
  }

  private viewText = ""

  private ensureView(): void {
    const styleWidth = typeof this.style.width === "number" ? this.style.width : Number(this.style.width)
    const width = this.layoutRect.width || (Number.isFinite(styleWidth) && styleWidth > 0 ? styleWidth : 0) || 80
    if (width === this.viewWidth && this.buffer.text === this.viewText) return
    this.view = new EditorView(computeVisualLines(this.buffer.text, width))
    this.view.setSource(this.buffer.text)
    this.viewWidth = width
    this.viewText = this.buffer.text
  }

  private marks(): ExtmarkHandle[] {
    return this.buffer.all()
  }

  override paint(ctx: PaintContext): void {
    void stringWidth
    const { buffer, clip } = ctx
    const r = this.layoutRect
    this.ensureView()
    const showPlaceholder = this.buffer.text.length === 0 && this.placeholder.length > 0
    const baseFg = this.focused && this.focusedTextColor !== undefined ? this.focusedTextColor : this.fg
    const source = showPlaceholder ? this.placeholder : this.buffer.text
    const marks = showPlaceholder ? [] : this.marks()
    const selStart = this.buffer.selectionStart
    const selEnd = this.buffer.selectionEnd
    this.cursorPosition = undefined
    for (let row = 0; row < r.height; row++) {
      const line = showPlaceholder
        ? { start: 0, end: source.length, width: stringWidth(source) }
        : this.view.line(this._scrollY + row)
      const y = r.y + row
      if (!line) {
        continue
      }
      let x = r.x
      let index = line.start
      while (index < line.end) {
        const grapheme = graphemes(source.slice(index, line.end))[0] ?? source[index] ?? " "
        const gw = Math.max(1, graphemeWidth(grapheme))
        const mark = showPlaceholder ? undefined : marks.find((m) => index >= m.start && index < m.end)
        const style = mark ? this.styleForId?.(mark.styleId) : undefined
        const selected = !showPlaceholder && index >= selStart && index < selEnd
        const fg = showPlaceholder ? this.placeholderColor : (style?.fg ?? baseFg)
        const bg = selected ? this.selectionColor : (style?.bg ?? this.bg)
        const attrs = (style?.attrs ?? Attr.None) | (selected ? Attr.None : Attr.None)
        if (x >= clip.x && x < clip.x + clip.width && y >= clip.y && y < clip.y + clip.height) {
          buffer.setChar(x, y, grapheme, fg, bg, attrs)
        }
        if (!showPlaceholder && this.buffer.cursor === index && this.focused) {
          this.cursorPosition = { x, y }
        }
        x += gw
        index += grapheme.length
      }
      if (
        !showPlaceholder &&
        this.buffer.cursor === line.end &&
        this.focused &&
        line === this.view.line(this.view.count - 1)
      ) {
        this.cursorPosition = { x: Math.min(x, r.x + r.width - 1), y }
      }
    }
    if (showPlaceholder) return
    if (this.focused && !this.cursorPosition) {
      const position = this.view.positionOf(this.buffer.cursor)
      const row = position.row - this._scrollY
      if (row >= 0 && row < r.height) this.cursorPosition = { x: r.x + position.col, y: r.y + row }
    }
  }
}
