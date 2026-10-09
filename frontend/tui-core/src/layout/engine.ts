import type { Node as YogaNode } from "yoga-layout/load"
import { ensureYoga, applyStyle } from "./yoga"
import { NO_COLOR } from "../render/cell"
import { parseColor } from "../color"
import type { Rect, Style } from "../types"

let idCounter = 0

export type PaintContext = Readonly<{
  buffer: import("../render/cell").CellBuffer
  clip: Rect
}>

export type MouseEventLike = Readonly<{
  type: "down" | "up" | "move" | "drag" | "wheelUp" | "wheelDown" | "wheelLeft" | "wheelRight"
  button: number
  x: number
  y: number
  localX: number
  localY: number
  ctrl: boolean
  alt: boolean
  shift: boolean
  stopPropagation(): void
}>

export type RenderableEventName = "mouse:down" | "mouse:up" | "mouse:move" | "mouse:wheel" | "key" | "paste" | "focus" | "blur"

export class Renderable {
  readonly id = ++idCounter
  style: Style = {}
  fg = NO_COLOR
  bg = NO_COLOR
  visible = true
  measurable = false
  zIndex = 0
  focused = false
  showCursor = true
  parent: Renderable | undefined
  children: Renderable[] = []
  yoga: YogaNode | undefined
  layoutRect: Rect = { x: 0, y: 0, width: 0, height: 0 }
  dirty = true
  private handlers = new Map<RenderableEventName, Set<(event: never) => unknown>>()

  on(event: RenderableEventName, handler: (payload: never) => unknown): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler as (payload: never) => unknown)
    return () => set?.delete(handler as (payload: never) => unknown)
  }

  emit(event: RenderableEventName, payload: unknown): boolean {
    const set = this.handlers.get(event)
    if (!set?.size) return false
    for (const handler of [...set]) if ((handler as (p: unknown) => unknown)(payload) === true) return true
    return false
  }

  hasHandlers(event: RenderableEventName): boolean {
    return (this.handlers.get(event)?.size ?? 0) > 0
  }

  constructor(style?: Style) {
    if (style) this.restyle(style)
  }

  restyle(style: Partial<Style> & { fg?: string | number; bg?: string | number }): void {
    Object.assign(this.style, style)
    if (style.fg !== undefined) this.fg = toColor(style.fg)
    if (style.bg !== undefined) this.bg = toColor(style.bg)
    this.markDirty()
  }

  markDirty(): void {
    let node: Renderable | undefined = this
    while (node && !node.dirty) {
      node.dirty = true
      node = node.parent
    }
  }

  addChild(child: Renderable): void {
    this.insertBefore(child, undefined)
  }

  insertBefore(child: Renderable, before: Renderable | undefined): void {
    if (child.parent) child.parent.removeChild(child)
    child.parent = this
    const index = before ? this.children.indexOf(before) : -1
    if (index === -1) this.children.push(child)
    else this.children.splice(index, 0, child)
    this.markDirty()
  }

  removeChild(child: Renderable): void {
    const index = this.children.indexOf(child)
    if (index === -1) return
    this.children.splice(index, 1)
    child.parent = undefined
    this.markDirty()
  }

  layoutStyle(): Style {
    return this.style
  }

  paint(_ctx: PaintContext): void {}
}

export function toColor(value: string | number | undefined): number {
  if (value === undefined) return NO_COLOR
  if (typeof value === "number") return value
  return parseColor(value)
}

export type OverflowViolation = Readonly<{
  node: number
  parent: number | undefined
  requestedWidth: number
  requestedHeight: number
  availableWidth: number
  availableHeight: number
}>

export type OverflowReport = Readonly<{
  violations: readonly OverflowViolation[]
  clamped: boolean
}>

class LayoutImpl {
  private Y!: Awaited<ReturnType<typeof ensureYoga>>

  async init(): Promise<void> {
    this.Y = await ensureYoga()
  }

  private ensure(node: Renderable): void {
    if (!node.yoga) node.yoga = this.Y.Node.create()
    applyStyle(node.yoga, node.layoutStyle())
    if (node.measurable) {
      // Yoga forbids children on measure nodes; inline children (text spans)
      // are laid out by the renderable itself, not by Yoga.
      node.yoga.setMeasureFunc((availableWidth, widthMode, availableHeight, heightMode) => {
        const w = widthMode === this.Y.MEASURE_MODE_UNDEFINED ? Infinity : availableWidth
        const size = (node as Measurable).measure(w)
        const width = widthMode === this.Y.MEASURE_MODE_EXACTLY ? availableWidth : size.width
        const height = heightMode === this.Y.MEASURE_MODE_EXACTLY ? availableHeight : size.height
        return { width, height }
      })
      return
    } else node.yoga.unsetMeasureFunc()
    for (const child of node.children) this.ensure(child)
  }

  private relink(node: Renderable): void {
    const yoga = node.yoga!
    while (yoga.getChildCount() > 0) yoga.removeChild(yoga.getChild(0))
    if (node.measurable) return
    for (const child of node.children) {
      yoga.insertChild(child.yoga!, yoga.getChildCount())
      this.relink(child)
    }
  }

  calculate(root: Renderable, width: number, height: number | undefined): OverflowReport {
    this.ensure(root)
    this.relink(root)
    root.yoga!.calculateLayout(width, height, this.Y.DIRECTION_LTR)
    const rects = new Map<Renderable, Rect>()
    const read = (node: Renderable, offsetX: number, offsetY: number) => {
      if (!node.yoga) return
      const layout = node.yoga.getComputedLayout()
      const rect: Rect = {
        x: offsetX + Math.round(layout.left),
        y: offsetY + Math.round(layout.top),
        width: Math.round(layout.width),
        height: Math.round(layout.height),
      }
      rects.set(node, rect)
      if (!node.measurable) for (const child of node.children) read(child, rect.x, rect.y)
    }
    read(root, 0, 0)
    const violations: OverflowViolation[] = []
    clampTree(root, rects, violations)
    for (const [node, rect] of rects) node.layoutRect = rect
    return { violations, clamped: violations.length > 0 }
  }
}

export interface Measurable extends Renderable {
  measure(availableWidth: number): Readonly<{ width: number; height: number }>
}

function clampTree(node: Renderable, rects: Map<Renderable, Rect>, violations: OverflowViolation[]): void {
  if (node.measurable) return
  const rect = rects.get(node)!
  for (const child of node.children) {
    let childRect = rects.get(child)!
    const maxRight = rect.x + rect.width
    const maxBottom = rect.y + rect.height
    if (childRect.x + childRect.width > maxRight && childRect.width > 0) {
      const availableWidth = Math.max(0, maxRight - childRect.x)
      violations.push({
        node: child.id,
        parent: node.id,
        requestedWidth: childRect.width,
        requestedHeight: childRect.height,
        availableWidth,
        availableHeight: childRect.height,
      })
      childRect = { ...childRect, width: availableWidth }
      rects.set(child, childRect)
    }
    if (childRect.y + childRect.height > maxBottom && childRect.height > 0) {
      const availableHeight = Math.max(0, maxBottom - childRect.y)
      violations.push({
        node: child.id,
        parent: node.id,
        requestedWidth: childRect.width,
        requestedHeight: childRect.height,
        availableWidth: childRect.width,
        availableHeight,
      })
      childRect = { ...childRect, height: availableHeight }
      rects.set(child, childRect)
    }
    clampTree(child, rects, violations)
  }
}

let impl: LayoutImpl | undefined

export async function createLayoutEngine(): Promise<LayoutImpl> {
  const next = new LayoutImpl()
  await next.init()
  impl = next
  return next
}

export function layoutEngine(): LayoutImpl {
  if (!impl) throw new Error("createLayoutEngine() must run before layout")
  return impl
}

export type { LayoutImpl as LayoutEngine }
