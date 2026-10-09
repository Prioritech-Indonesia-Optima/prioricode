// createCliRenderer-compatible boot for the core engine: returns a
// CliRenderer-shaped facade so host code written against OpenTUI can drive
// tui-core during the transition (S7 preload maps the specifier).
import { CoreRenderer, type OutputDevice } from "../render/renderer"
import { FrameScheduler } from "../render/scheduler"
import { createLayoutEngine } from "../layout/engine"
import { Renderable } from "../layout/engine"
import { createTerminal, type Terminal } from "../io/terminal"

export type CoreCliRenderer = CoreRenderer & Readonly<{ terminal: Terminal; root: Renderable }>

export type CreateRendererOptions = Readonly<{
  targetFps?: number
  exitOnCtrlC?: boolean
  useMouse?: boolean
  useKittyKeyboard?: boolean | { events?: boolean }
  autoFocus?: boolean
  externalOutputMode?: "passthrough" | "capture-stdout"
  width?: number
  height?: number
  write?: (data: string) => void
}>

export async function createCliRendererCore(options: CreateRendererOptions = {}): Promise<CoreRenderer & { terminal: Terminal; root: Renderable }> {
  await createLayoutEngine()
  const terminal = createTerminal({
    mouse: options.useMouse,
    write: options.write,
  })
  const device: OutputDevice = {
    columns: options.width ?? terminal.columns,
    rows: options.height ?? terminal.rows,
    write: (data) => terminal.write(data),
    resizeTo: (columns, rows) => {
      device.columns = columns
      device.rows = rows
    },
  }
  const root = new Renderable({ width: "100%", height: "100%" })
  const scheduler = new FrameScheduler()
  const renderer = new CoreRenderer({ device, root, scheduler })
  terminal.onResize((columns, rows) => renderer.resize(columns, rows))
  terminal.onInput((event) => {
    if (event.kind === "key") return renderer.handleKey(event)
    if (event.kind === "paste") return renderer.handlePaste(event)
    if (event.kind === "mouse") return renderer.handleMouse(event)
    return undefined
  })
  if (options.externalOutputMode !== "capture-stdout") await terminal.start()
  return Object.assign(renderer, { terminal, root }) as CoreRenderer & { terminal: Terminal; root: Renderable }
}
