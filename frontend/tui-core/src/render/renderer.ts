import { CellBuffer, type Cell } from "./cell"
import { diffBuffers, emitRuns } from "./emit"
import { FrameScheduler } from "./scheduler"
import type { Renderable } from "../layout/engine"
import { layoutEngine } from "../layout/engine"
import type { Rect } from "../types"

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
  private front: CellBuffer
  private back: CellBuffer
  private readonly root: Renderable
  private readonly device: OutputDevice
  private disposed = false
  private frames = 0

  constructor(options: RendererOptions) {
    this.root = options.root
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
    for (const child of node.children) this.paintNode(child, buffer, node.style.overflow === "visible" ? clip : childClip)
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
