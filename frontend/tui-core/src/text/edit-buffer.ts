import { graphemes, graphemeWidth } from "../text"

export interface ExtmarkHandle {
  readonly id: number
  readonly typeId: number
  start: number
  end: number
  virtual: boolean
  styleId?: number
}

export type ExtmarkChange = Readonly<{
  removed?: ExtmarkHandle[]
  shifted?: ExtmarkHandle[]
}>

// Insert/delete-aware text buffer with anchored extmark ranges. Offsets are
// UTF-16 indices into `text`. Insertion exactly at a range start pushes the
// whole range right (typing before a chip must not grow it); insertion in
// (start, end) extends the end.
export class EditBuffer {
  text = ""
  cursor = 0
  anchor: number | undefined
  private marks: ExtmarkHandle[] = []
  private nextId = 1
  readonly typeIds = new Map<string, number>()
  onChange?: (change: ExtmarkChange) => void

  registerType(name: string): number {
    const existing = this.typeIds.get(name)
    if (existing !== undefined) return existing
    const id = this.typeIds.size + 1
    this.typeIds.set(name, id)
    return id
  }

  create(input: Readonly<{ start: number; end: number; typeId: number; virtual?: boolean; styleId?: number }>): number {
    const mark: ExtmarkHandle = {
      id: this.nextId++,
      typeId: input.typeId,
      start: Math.max(0, Math.min(input.start, this.text.length)),
      end: Math.max(0, Math.min(input.end, this.text.length)),
      virtual: input.virtual ?? false,
      styleId: input.styleId,
    }
    this.marks.push(mark)
    this.marks.sort((a, b) => a.start - b.start || a.id - b.id)
    return mark.id
  }

  remove(id: number): void {
    this.marks = this.marks.filter((mark) => mark.id !== id)
  }

  get(id: number): ExtmarkHandle | undefined {
    return this.marks.find((mark) => mark.id === id)
  }

  getAllForTypeId(typeId: number): ExtmarkHandle[] {
    return this.marks.filter((mark) => mark.typeId === typeId)
  }

  all(): ExtmarkHandle[] {
    return [...this.marks]
  }

  marksAt(index: number): ExtmarkHandle[] {
    return this.marks.filter((mark) => index > mark.start && index <= mark.end)
  }

  clear(): void {
    this.marks = []
  }

  get selectionStart(): number {
    if (this.anchor === undefined) return this.cursor
    return Math.min(this.anchor, this.cursor)
  }

  get selectionEnd(): number {
    if (this.anchor === undefined) return this.cursor
    return Math.max(this.anchor, this.cursor)
  }

  get hasSelection(): boolean {
    return this.anchor !== undefined && this.anchor !== this.cursor
  }

  insert(text: string): ExtmarkChange {
    const change: ExtmarkChange = {}
    if (this.hasSelection) this.deleteRange(this.selectionStart, this.selectionEnd)
    const at = this.cursor
    this.text = this.text.slice(0, at) + text + this.text.slice(at)
    for (const mark of this.marks) {
      // Insertion at/ before the start pushes the whole range right (a chip
      // typed in front of stays intact); insertion strictly inside extends it;
      // insertion exactly at the end does neither.
      if (at <= mark.start) mark.start += text.length
      if (at < mark.end) mark.end += text.length
    }
    this.cursor = at + text.length
    this.anchor = undefined
    this.resort()
    this.notify(change)
    return change
  }

  deleteRange(start: number, end: number): ExtmarkChange {
    const change: ExtmarkChange = { removed: [], shifted: [] }
    const length = end - start
    if (length <= 0) return change
    this.text = this.text.slice(0, start) + this.text.slice(end)
    const kept: ExtmarkHandle[] = []
    for (const mark of this.marks) {
      if (mark.end <= start) {
        kept.push(mark)
        continue
      }
      if (mark.start >= end) {
        kept.push({ ...mark, start: mark.start - length, end: mark.end - length })
        change.shifted!.push(kept[kept.length - 1]!)
        continue
      }
      const newStart = Math.min(mark.start, start)
      const newEnd = Math.max(mark.end - length, newStart)
      if (newEnd <= newStart) {
        change.removed!.push(mark)
        continue
      }
      kept.push({ ...mark, start: newStart, end: newEnd })
    }
    this.marks = kept
    if (this.cursor > end) this.cursor -= length
    else this.cursor = Math.max(start, Math.min(this.cursor, start))
    this.anchor = undefined
    this.resort()
    this.notify(change)
    return change
  }

  // Grapheme-aware backward delete. When the deleted cluster falls inside a
  // non-empty range, the whole range goes (prompt chips delete atomically).
  deleteBackward(): ExtmarkChange {
    if (this.hasSelection) return this.deleteRange(this.selectionStart, this.selectionEnd)
    if (this.cursor === 0) return {}
    const parts = graphemes(this.text.slice(0, this.cursor))
    const step = Math.max(1, parts[parts.length - 1]?.length ?? 1)
    const inside = this.marksAt(this.cursor).filter((mark) => mark.end - mark.start > 0)
    if (inside.length) return this.deleteRange(inside[0]!.start, this.cursor)
    return this.deleteRange(this.cursor - step, this.cursor)
  }

  deleteForward(): ExtmarkChange {
    if (this.hasSelection) return this.deleteRange(this.selectionStart, this.selectionEnd)
    if (this.cursor >= this.text.length) return {}
    const rest = graphemes(this.text.slice(this.cursor))
    const step = Math.max(1, rest[0]?.length ?? 1)
    const inside = this.marks.filter((mark) => mark.start === this.cursor && mark.end > mark.start)
    if (inside.length) return this.deleteRange(this.cursor, inside[0]!.end)
    return this.deleteRange(this.cursor, this.cursor + step)
  }

  setText(text: string): void {
    this.text = text
    this.cursor = Math.min(this.cursor, text.length)
    this.anchor = undefined
    this.marks = []
    this.notify({})
  }

  setCursor(index: number, extend = false): void {
    const next = Math.max(0, Math.min(index, this.text.length))
    if (extend) this.anchor = this.anchor ?? this.cursor
    else this.anchor = undefined
    this.cursor = next
  }

  lineBounds(offset = this.cursor): Readonly<{ start: number; end: number }> {
    const start = offset === 0 ? 0 : this.text.lastIndexOf("\n", offset - 1) + 1
    const nextBreak = this.text.indexOf("\n", offset)
    return { start, end: nextBreak === -1 ? this.text.length : nextBreak }
  }

  private resort(): void {
    this.marks.sort((a, b) => a.start - b.start || a.id - b.id)
  }

  private notify(change: ExtmarkChange): void {
    this.onChange?.(change)
  }

  widthUpTo(index: number): number {
    let width = 0
    for (const grapheme of graphemes(this.text.slice(0, index))) width += graphemeWidth(grapheme)
    return width
  }
}
