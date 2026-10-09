import { Renderable, layoutEngine, toColor, type MouseEventLike, type PaintContext } from "../layout/engine"
import { NO_COLOR, type CellBuffer } from "../render/cell"
import { Attr, type Rect, type Style } from "../types"

export interface ScrollViewportOptions {
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
}

export interface ScrollbarTrackOptions {
  foregroundColor?: string | number
  backgroundColor?: string | number
}

export interface VerticalScrollbarOptions {
  visible?: boolean
  paddingLeft?: number
  trackOptions?: ScrollbarTrackOptions
}

export type ScrollBoxProps = Style & {
  viewportOptions?: ScrollViewportOptions
  verticalScrollbarOptions?: VerticalScrollbarOptions
  stickyScroll?: boolean
}

export const SCROLL_WHEEL_ROWS = 3

const DEFAULT_THUMB_COLOR = 0x808080

class ScrollContentRenderable extends Renderable {
  viewportWidth: number | undefined = undefined

  override layoutStyle(): Style {
    return { display: "flex", flexDirection: "column", width: this.viewportWidth }
  }
}

function intersectClip(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  }
}

function orderedChildren(children: readonly Renderable[]): Renderable[] {
  return children
    .map((child, index) => ({ child, index }))
    .sort((a, b) => a.child.zIndex - b.child.zIndex || a.index - b.index)
    .map((entry) => entry.child)
}

export class ScrollBoxRenderable extends Renderable {
  viewportOptions: ScrollViewportOptions = {}
  verticalScrollbarOptions: VerticalScrollbarOptions = {}
  stickyScroll = true
  y = 0
  scrollHeight = 0
  visibleHeight = 0
  readonly content = new ScrollContentRenderable()

  constructor(props?: ScrollBoxProps) {
    super(props)
    if (props?.viewportOptions) this.viewportOptions = { ...props.viewportOptions }
    if (props?.verticalScrollbarOptions) {
      const options = props.verticalScrollbarOptions
      this.verticalScrollbarOptions = {
        ...options,
        trackOptions: options.trackOptions ? { ...options.trackOptions } : undefined,
      }
    }
    if (props?.stickyScroll !== undefined) this.stickyScroll = props.stickyScroll
    this.addChild(this.content)
    this.on("mouse:wheel", (event: MouseEventLike) => {
      if (event.type === "wheelUp") {
        this.scrollBy(-SCROLL_WHEEL_ROWS)
        return true
      }
      if (event.type === "wheelDown") {
        this.scrollBy(SCROLL_WHEEL_ROWS)
        return true
      }
      return false
    })
  }

  get scrollbarVisible(): boolean {
    return this.verticalScrollbarOptions.visible ?? true
  }

  get maxScroll(): number {
    return Math.max(0, this.scrollHeight - this.visibleHeight)
  }

  scrollTo(target: number): void {
    this.applyScroll(target)
  }

  scrollBy(delta: number): void {
    this.applyScroll(this.y + delta)
  }

  scrollToEnd(): void {
    this.applyScroll(this.scrollHeight)
  }

  override insertBefore(child: Renderable, before: Renderable | undefined): void {
    if (child === this.content) {
      super.insertBefore(child, before)
      return
    }
    this.content.insertBefore(child, before)
  }

  override removeChild(child: Renderable): void {
    if (child === this.content) {
      super.removeChild(child)
      return
    }
    this.content.removeChild(child)
  }

  private applyScroll(target: number): void {
    const max = this.maxScroll
    const next = Number.isFinite(target) ? Math.max(0, Math.min(max, Math.floor(target))) : max
    this.y = next
    // Only meaningful once real bounds are known; before the first layout the
    // zero max would otherwise misread every command as "pinned at end".
    if (max > 0) this.stickyScroll = next >= max
    this.markDirty()
  }

  private insets(): Readonly<{ left: number; right: number; top: number; bottom: number }> {
    const base = this.style
    const viewport = this.viewportOptions
    const reserve = this.scrollbarVisible ? 1 + Math.max(0, this.verticalScrollbarOptions.paddingLeft ?? 0) : 0
    return {
      left: (base.paddingLeft ?? 0) + (viewport.paddingLeft ?? 0),
      right: (base.paddingRight ?? 0) + (viewport.paddingRight ?? 0) + reserve,
      top: (base.paddingTop ?? 0) + (viewport.paddingTop ?? 0),
      bottom: (base.paddingBottom ?? 0) + (viewport.paddingBottom ?? 0),
    }
  }

  override layoutStyle(): Style {
    const inset = this.insets()
    return {
      ...this.style,
      paddingLeft: inset.left,
      paddingRight: inset.right,
      paddingTop: inset.top,
      paddingBottom: inset.bottom,
    }
  }

  override paint(ctx: PaintContext): void {
    const box = this.layoutRect
    const inset = this.insets()
    const inner: Rect = {
      x: box.x + inset.left,
      y: box.y + inset.top,
      width: Math.max(0, box.width - inset.left - inset.right),
      height: Math.max(0, box.height - inset.top - inset.bottom),
    }
    this.visibleHeight = inner.height
    this.content.viewportWidth = inner.width
    if (inner.width > 0 && inner.height > 0) {
      // Re-run layout over the content subtree with undefined (auto) height;
      // the main pass clamps children to the viewport, which would squish
      // scrolled rows.
      layoutEngine().calculate(this.content, inner.width, undefined)
      const contentHeight = this.content.layoutRect.height
      this.scrollHeight = Number.isFinite(contentHeight) && contentHeight > 0 ? Math.round(contentHeight) : 0
    } else {
      this.scrollHeight = 0
    }
    const max = Math.max(0, this.scrollHeight - inner.height)
    if (this.stickyScroll) this.y = max
    else this.y = Math.max(0, Math.min(Math.floor(this.y), max))

    if (this.bg >= 0) {
      for (let y = box.y; y < box.y + box.height; y++) {
        for (let x = box.x; x < box.x + box.width; x++) {
          if (x < ctx.clip.x || y < ctx.clip.y || x >= ctx.clip.x + ctx.clip.width || y >= ctx.clip.y + ctx.clip.height) continue
          ctx.buffer.setChar(x, y, " ", this.fg, this.bg, Attr.None)
        }
      }
    }

    if (inner.width > 0 && inner.height > 0) {
      const clip = intersectClip(ctx.clip, inner)
      if (clip.width > 0 && clip.height > 0) {
        // The content wrapper still carries its unbounded relative layout rect
        // from the inner pass; the walk shifts it (and all descendants) by the
        // viewport origin minus the scroll offset and leaves the shifted rects
        // in place so the renderer's own child recursion paints identically.
        this.paintShifted(ctx.buffer, clip, this.content, inner.x, inner.y - this.y)
      }
      // Pin the wrapper itself to the viewport box so the renderer's child
      // recursion clips shifted descendants to exactly the visible region.
      this.content.layoutRect = inner
    }
    this.paintScrollbar(ctx.buffer, ctx.clip, inner)
  }

  private paintShifted(buffer: CellBuffer, clip: Rect, node: Renderable, offsetX: number, offsetY: number): void {
    if (!node.visible || node.style.display === "none") return
    const base = node.layoutRect
    const rect: Rect = { x: base.x + offsetX, y: base.y + offsetY, width: base.width, height: base.height }
    node.layoutRect = rect
    node.paint({ buffer, clip })
    // Nested scroll boxes repaint their own subtree with their own offset.
    if (node.measurable || node instanceof ScrollBoxRenderable) return
    const childClip = node.style.overflow === "visible" ? clip : intersectClip(clip, rect)
    if (childClip.width <= 0 || childClip.height <= 0) return
    for (const child of orderedChildren(node.children)) {
      this.paintShifted(buffer, childClip, child, offsetX, offsetY)
    }
  }

  private paintScrollbar(buffer: CellBuffer, clip: Rect, inner: Rect): void {
    if (!this.scrollbarVisible || inner.height <= 0 || this.layoutRect.width <= 0) return
    const column = this.layoutRect.x + this.layoutRect.width - 1
    const track = this.verticalScrollbarOptions.trackOptions
    const thumbColor = toColor(track?.foregroundColor ?? DEFAULT_THUMB_COLOR)
    const trackColor = toColor(track?.backgroundColor)
    const total = Math.max(1, this.scrollHeight)
    const thumbHeight = Math.min(inner.height, Math.max(1, Math.round((inner.height * inner.height) / total)))
    const max = this.maxScroll
    const fraction = max > 0 ? Math.min(1, Math.max(0, this.y / max)) : 0
    const thumbTop = inner.y + Math.round(fraction * (inner.height - thumbHeight))
    for (let row = inner.y; row < inner.y + inner.height; row++) {
      if (column < clip.x || row < clip.y || column >= clip.x + clip.width || row >= clip.y + clip.height) continue
      const isThumb = row >= thumbTop && row < thumbTop + thumbHeight
      buffer.setChar(column, row, " ", NO_COLOR, isThumb ? thumbColor : trackColor, Attr.None)
    }
  }
}
