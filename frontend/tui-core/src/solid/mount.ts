import { createContext, createComponent, createSignal, useContext, type Accessor, type ParentProps } from "solid-js"
import { CoreRenderer, type OutputDevice } from "../render/renderer"
import { FrameScheduler } from "../render/scheduler"
import { createLayoutEngine } from "../layout/engine"
import { Renderable } from "../layout/engine"
import { renderSolid } from "./renderer"

export type TuiDimensions = Readonly<{ width: number; height: number }>

export type TuiContext = Readonly<{
  renderer: CoreRenderer
  root: Renderable
  device: OutputDevice
  dimensions: Accessor<TuiDimensions>
}>

const TuiCtx = createContext<TuiContext>()

export function useTui(): TuiContext {
  const ctx = useContext(TuiCtx)
  if (!ctx) throw new Error("useTui must be used inside the tui-core mount provider")
  return ctx
}

export function useRenderer(): CoreRenderer {
  return useTui().renderer
}

export function useTerminalDimensions(): Accessor<TuiDimensions> {
  return useTui().dimensions
}

export type MountedApp = Readonly<{
  renderer: CoreRenderer
  root: Renderable
  device: OutputDevice
  resize(columns: number, rows: number): void
  dispose(): void
}>

export async function mount(code: () => unknown, options: Readonly<{ device: OutputDevice; scheduler?: FrameScheduler }>): Promise<MountedApp> {
  await createLayoutEngine()
  const root = new Renderable({ width: "100%", height: "100%" })
  const scheduler = options.scheduler ?? new FrameScheduler()
  const renderer = new CoreRenderer({ device: options.device, root, scheduler })
  const [dimensions, setDimensions] = createSignal<TuiDimensions>({
    width: options.device.columns,
    height: options.device.rows,
  })
  const ctx: TuiContext = { renderer, root, device: options.device, dimensions }
  const Provider = TuiCtx.Provider as unknown as (props: { value: TuiContext; children?: unknown }) => Renderable
  const disposeTree = renderSolid(
    () =>
      createComponent(Provider as never, {
        value: ctx,
        get children() {
          return code()
        },
      } as never) as unknown as Renderable,
    root,
  )
  renderer.renderNow()
  return {
    renderer,
    root,
    device: options.device,
    resize: (columns, rows) => {
      options.device.columns = columns
      options.device.rows = rows
      renderer.resize(columns, rows)
      setDimensions(() => ({ width: columns, height: rows }))
    },
    dispose: () => {
      disposeTree()
      renderer.dispose()
    },
  }
}
