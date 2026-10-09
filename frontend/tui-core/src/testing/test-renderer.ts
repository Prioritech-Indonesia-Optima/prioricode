import { CoreRenderer, type OutputDevice } from "../render/renderer"
import { FrameScheduler } from "../render/scheduler"
import { createLayoutEngine } from "../layout/engine"
import { Renderable } from "../layout/engine"
import { BoxRenderable } from "../primitives/box"
import { TextRenderable } from "../primitives/text"

export type TestRenderer = Readonly<{
  renderer: CoreRenderer
  root: Renderable
  scheduler: FrameScheduler
  box(style?: import("../types").BoxStyle): BoxRenderable
  text(style?: import("../types").TextStyleProps): TextRenderable
  output(): string
  charFrame(): string
  frameCount(): number
  waitForFrame(predicate: (frame: string) => boolean, options?: { maxPasses?: number }): Promise<string>
  resize(columns: number, rows: number): void
  destroy(): void
}>

export async function createTestRenderer(options: Readonly<{ width: number; height: number }>): Promise<TestRenderer> {
  await createLayoutEngine()
  const root = new Renderable({ width: "100%", height: "100%" })
  const chunks: string[] = []
  const device: OutputDevice = {
    columns: options.width,
    rows: options.height,
    write: (data) => void chunks.push(data),
    resizeTo: () => {},
  }
  const scheduler = new FrameScheduler()
  const renderer = new CoreRenderer({ device, root, scheduler })
  renderer.renderNow()
  return {
    renderer,
    root,
    scheduler,
    box: (style) => new BoxRenderable(style),
    text: (style) => new TextRenderable(style),
    output: () => chunks.join(""),
    charFrame: () => renderer.captureCharFrame(),
    frameCount: () => renderer.frameCount,
    async waitForFrame(predicate, waitOptions) {
      const maxPasses = waitOptions?.maxPasses ?? 60
      for (let i = 0; i < maxPasses; i++) {
        renderer.renderNow()
        const frame = renderer.captureCharFrame()
        if (predicate(frame)) return frame
        await Bun.sleep(5)
      }
      return renderer.captureCharFrame()
    },
    resize: (columns, rows) => {
      device.columns = columns
      device.rows = rows
      renderer.resize(columns, rows)
      renderer.renderNow()
    },
    destroy: () => {
      renderer.dispose()
    },
  }
}
