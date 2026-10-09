import { CellBuffer, type Cell } from "./cell"
import { diffBuffers, emitRuns } from "./emit"
import { FrameScheduler } from "./scheduler"
import type { MouseEventLike, Renderable as RenderableType } from "../layout/engine"
import { Renderable, layoutEngine } from "../layout/engine"
import type { InputEvent, KeyEvent, Rect } from "../types"

export type OutputDevice = {
  columns: number
  rows: number
  write(data: string): void
  resizeTo?(columns: number, rows: number): void
}

export type RendererOptions = Readonly<{
  device: OutputDevice
  root: Renderable
  scheduler?: FrameScheduler
}>

export class CoreRenderer {
  readonly scheduler: FrameScheduler
  readonly overlays: Renderable
  private focusTarget: Renderable | undefined
  private front: CellBuffer
  private back: CellBuffer
  private readonly root: Renderable
  private readonly device: OutputDevice
  private disposed = false
  private frames = 0
  private postProcess: ((buffer: CellBuffer, deltaTime: number) => void)[] = []
  private lastPaint = 0

  constructor(options: RendererOptions) {
    this.root = options.root
    this.overlays = new Renderable({ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "flex" })
    this.overlays.zIndex = 1_000_000
    options.root.addChild(this.overlays)
    this.device = options.device
    this.scheduler = options.scheduler ?? new FrameScheduler()
    this.front = new CellBuffer(options.device.columns, options.device.rows)
    this.back = new CellBuffer(options.device.columns, options.device.rows)
    this.scheduler.setDraw(() => this.paintAndEmit())
  }

  get frameCount(): number {
    return this.frames
  }

  get columns(): number {
    return this.front.width
  }

  get rows(): number {
    return this.front.height
  }

  write(data: string): void {
    this.device.write(data)
  }

  setTerminalTitle(title: string): void {
    this.device.write(`\x1b]0;${title.replace(/[\x00-\x1f\x07]/g, "")}\x07`)
  }

  addPostProcessFn(fn: (buffer: CellBuffer, deltaTime: number) => void): void {
    if (!this.postProcess.includes(fn)) this.postProcess.push(fn)
  }

  removePostProcessFn(fn: (buffer: CellBuffer, deltaTime: number) => void): void {
    const index = this.postProcess.indexOf(fn)
    if (index !== -1) this.postProcess.splice(index, 1)
  }

  resize(columns: number, rows: number): void {
    if (columns === this.front.width && rows === this.front.height) return
    this.front = new CellBuffer(columns, rows)
    this.back = new CellBuffer(columns, rows)
    this.device.resizeTo?.(columns, rows)
    this.markAllDirty(this.root)
    this.scheduler.requestRender()
  }

  private markAllDirty(node: Renderable): void {
    node.markDirty()
    for (const child of node.children) this.markAllDirty(child)
  }

  renderNow(): void {
    if (this.disposed) return
    this.paintAndEmit()
  }

  private paintAndEmit(): void {
    if (this.root.dirty === false && this.frames > 0) return
    this.frames++
    const size = { columns: this.device.columns, rows: this.device.rows }
    if (size.columns !== this.front.width || size.rows !== this.front.height) {
      this.front = new CellBuffer(size.columns, size.rows)
      this.back = new CellBuffer(size.columns, size.rows)
    }
    const next = this.front
    next.clear()
    const report = layoutEngine().calculate(this.root, size.columns, size.rows)
    void report
    this.paintNode(this.root, next, { x: 0, y: 0, width: size.columns, height: size.rows })
    const now = Date.now()
    const deltaTime = this.lastPaint === 0 ? 0 : now - this.lastPaint
    this.lastPaint = now
    for (const fn of this.postProcess) fn(next, deltaTime)
    const runs = diffBuffers(this.back.width === next.width && this.back.height === next.height ? this.back : undefined, next)
    const out = emitRuns(runs)
    if (out.length) this.device.write(out)
    this.back.copyFrom(next)
    this.clearDirtyTree(this.root)
  }

  private paintNode(node: Renderable, buffer: CellBuffer, clip: Rect): void {
    if (!node.visible || node.style.display === "none") return
    const r = node.layoutRect
    const childClip: Rect = {
      x: Math.max(clip.x, r.x),
      y: Math.max(clip.y, r.y),
      width: Math.max(0, Math.min(clip.x + clip.width, r.x + r.width) - Math.max(clip.x, r.x)),
      height: Math.max(0, Math.min(clip.y + clip.height, r.y + r.height) - Math.max(clip.y, r.y)),
    }
    node.paint({ buffer, clip })
    if (node.measurable) return
    for (const child of ordered(node.children)) this.paintNode(child, buffer, node.style.overflow === "visible" ? clip : childClip)
  }

  hitTest(x: number, y: number): RenderableType | undefined {
    const walk = (node: RenderableType, clip: Rect): RenderableType | undefined => {
      if (!node.visible || node.style.display === "none") return undefined
      const r = node.layoutRect
      if (x < Math.max(r.x, clip.x) || y < Math.max(r.y, clip.y) || x >= Math.min(r.x + r.width, clip.x + clip.width) || y >= Math.min(r.y + r.height, clip.y + clip.height)) return undefined
      if (!node.measurable) {
        for (const child of [...ordered(node.children)].reverse()) {
          const found = walk(child, {
            x: Math.max(r.x, clip.x),
            y: Math.max(r.y, clip.y),
            width: Math.max(0, Math.min(r.x + r.width, clip.x + clip.width) - Math.max(r.x, clip.x)),
            height: Math.max(0, Math.min(r.y + r.height, clip.y + clip.height) - Math.max(r.y, clip.y)),
          })
          if (found) return found
        }
      }
      if (node === this.overlays) return undefined
      return node
    }
    return walk(this.root, { x: 0, y: 0, width: this.front.width, height: this.front.height })
  }

  handleMouse(event: Extract<InputEvent, { kind: "mouse" }>): boolean {
    const target = this.hitTest(event.x, event.y)
    const bucket: "mouse:down" | "mouse:up" | "mouse:move" | "mouse:wheel" =
      event.type === "down" ? "mouse:down" : event.type === "up" ? "mouse:up" : event.type.startsWith("wheel") ? "mouse:wheel" : "mouse:move"
    if (target?.hasHandlers("key")) this.focus(target)
    let node: RenderableType | undefined = target
    let handled = false
    let stopped = false
    while (node && !stopped) {
      if (node.hasHandlers(bucket)) {
        handled = true
        const payload: MouseEventLike = {
          type: event.type,
          button: event.button,
          x: event.x,
          y: event.y,
          localX: event.x - node.layoutRect.x,
          localY: event.y - node.layoutRect.y,
          ctrl: event.ctrl,
          alt: event.alt,
          shift: event.shift,
          stopPropagation: () => {
            stopped = true
          },
        }
        if (node.emit(bucket, payload) === true) stopped = true
      }
      node = node.parent
    }
    return handled
  }

  focus(node: RenderableType | undefined): void {
    if (this.focusTarget === node) return
    if (this.focusTarget) {
      this.focusTarget.focused = false
      this.focusTarget.emit("blur", undefined)
    }
    this.focusTarget = node
    if (node) {
      node.focused = true
      node.emit("focus", undefined)
    }
  }

  get focusedNode(): RenderableType | undefined {
    return this.focusTarget
  }

  handleKey(event: KeyEvent): boolean {
    return this.focusTarget?.emit("key", event) === true
  }

  private clearDirtyTree(node: Renderable): void {
    node.dirty = false
    for (const child of node.children) this.clearDirtyTree(child)
  }

  captureCharFrame(): string {
    return this.back.charFrame()
  }

  currentCells(): Cell[] {
    return this.back.cells.slice()
  }

  dispose(): void {
    this.disposed = true
    this.scheduler.dispose()
  }
}

function ordered(children: readonly RenderableType[]): RenderableType[] {
  return children
    .map((child, index) => ({ child, index }))
    .sort((a, b) => (a.child.zIndex - b.child.zIndex || a.index - b.index))
    .map((entry) => entry.child)
}
