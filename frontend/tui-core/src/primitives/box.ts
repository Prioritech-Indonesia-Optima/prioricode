import { Renderable, type PaintContext, toColor } from "../layout/engine"
import type { BorderEdge, BoxStyle, Style } from "../types"

const BORDER_GLYPHS = {
  horizontal: "─",
  vertical: "│",
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
}

export function hasEdge(border: BoxStyle["border"], edge: BorderEdge): boolean {
  if (!border) return false
  if (border === "all") return true
  if (typeof border === "string") return border === edge
  return border.includes(edge)
}

export class BoxRenderable extends Renderable {
  border?: BoxStyle["border"]
  borderColor = 0x808080
  title = ""

  constructor(style?: BoxStyle) {
    super(style)
    this.applyBoxStyle(style)
  }

  applyBoxStyle(style?: BoxStyle): void {
    if (!style) return
    if (style.border !== undefined) this.border = style.border
    if (style.borderColor !== undefined) this.borderColor = toColor(style.borderColor)
    if (style.title !== undefined) this.title = style.title
  }

  // Borders consume one cell on their edge, exactly like padding.
  override layoutStyle(): Style {
    const base = this.style
    if (!this.border) return base
    const inset = {
      paddingLeft: (base.paddingLeft ?? 0) + (hasEdge(this.border, "left") ? 1 : 0),
      paddingRight: (base.paddingRight ?? 0) + (hasEdge(this.border, "right") ? 1 : 0),
      paddingTop: (base.paddingTop ?? 0) + (hasEdge(this.border, "top") ? 1 : 0),
      paddingBottom: (base.paddingBottom ?? 0) + (hasEdge(this.border, "bottom") ? 1 : 0),
    }
    return { ...base, ...inset }
  }

  override paint(ctx: PaintContext): void {
    const { buffer, clip } = ctx
    const r = this.layoutRect
    if (this.bg >= 0) {
      for (let y = r.y; y < r.y + r.height; y++)
        for (let x = r.x; x < r.x + r.width; x++) {
          if (x < clip.x || y < clip.y || x >= clip.x + clip.width || y >= clip.y + clip.height) continue
          buffer.setChar(x, y, " ", this.fg, this.bg, 0)
        }
    }
    const draw = (x: number, y: number, ch: string) => {
      if (x < clip.x || y < clip.y || x >= clip.x + clip.width || y >= clip.y + clip.height) return
      buffer.setChar(x, y, ch, this.borderColor, this.bg, 0)
    }
    if (this.border) {
      const top = hasEdge(this.border, "top")
      const bottom = hasEdge(this.border, "bottom")
      const left = hasEdge(this.border, "left")
      const right = hasEdge(this.border, "right")
      if (top) for (let x = r.x + (left ? 1 : 0); x < r.x + r.width - (right ? 1 : 0); x++) draw(x, r.y, BORDER_GLYPHS.horizontal)
      if (bottom) for (let x = r.x + (left ? 1 : 0); x < r.x + r.width - (right ? 1 : 0); x++) draw(x, r.y + r.height - 1, BORDER_GLYPHS.horizontal)
      if (left) for (let y = r.y + (top ? 1 : 0); y < r.y + r.height - (bottom ? 1 : 0); y++) draw(r.x, y, BORDER_GLYPHS.vertical)
      if (right) for (let y = r.y + (top ? 1 : 0); y < r.y + r.height - (bottom ? 1 : 0); y++) draw(r.x + r.width - 1, y, BORDER_GLYPHS.vertical)
      if (top && left) draw(r.x, r.y, BORDER_GLYPHS.topLeft)
      if (top && right) draw(r.x + r.width - 1, r.y, BORDER_GLYPHS.topRight)
      if (bottom && left) draw(r.x, r.y + r.height - 1, BORDER_GLYPHS.bottomLeft)
      if (bottom && right) draw(r.x + r.width - 1, r.y + r.height - 1, BORDER_GLYPHS.bottomRight)
      if (this.title && top) {
        let x = r.x + 1
        for (const ch of this.title) {
          if (x >= r.x + r.width - 1) break
          draw(x++, r.y, ch)
        }
      }
    }
  }
}
