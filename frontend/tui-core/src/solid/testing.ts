import { mount, type MountedApp } from "./mount"
import type { Renderable } from "../layout/engine"

export type SolidTestRenderer = MountedApp & Readonly<{
  charFrame(): string
  waitForFrame(predicate: (frame: string) => boolean): Promise<string>
  output(): string
}>

export async function testRender(
  code: () => Renderable,
  options: Readonly<{ width: number; height: number }>,
): Promise<SolidTestRenderer> {
  const chunks: string[] = []
  const app = await mount(code, {
    device: {
      columns: options.width,
      rows: options.height,
      write: (data) => void chunks.push(data),
      resizeTo: () => {},
    },
  })
  return {
    ...app,
    output: () => chunks.join(""),
    charFrame: () => app.renderer.captureCharFrame(),
    async waitForFrame(predicate) {
      for (let i = 0; i < 120; i++) {
        app.renderer.renderNow()
        const frame = app.renderer.captureCharFrame()
        if (predicate(frame)) return frame
        await Bun.sleep(5)
      }
      return app.renderer.captureCharFrame()
    },
  }
}
