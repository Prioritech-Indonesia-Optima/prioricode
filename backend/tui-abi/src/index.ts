// Framework-neutral TUI plugin ABI (see specs/tui-plugin-abi-census.md).
// Hosts construct an `EngineSurface` from whichever engine is active; plugin
// code that touches engine primitives goes through this contract instead of
// `@opentui/*` directly. OpenTUI is a peer engine, never a dependency here.

export const TUI_ABI_VERSION = 1 as const

// ---------------------------------------------------------------- colors

export type AbiColorLike = Readonly<{
  r: number
  g: number
  b: number
  a: number
  toHex(withAlpha?: boolean): string
  toInts(): readonly [number, number, number, number]
  toString(withAlpha?: boolean): string
}>

// ---------------------------------------------------------------- effects

// A registered frame-buffer post-processing effect. `frame` is engine-owned
// (OpenTUI passes its native buffer; tui-core passes its cell grid) and the
// effect implementation is engine-specific; the ABI standardizes only the
// lifecycle shape.
export type AbiEffect = Readonly<{
  kind: "vignette"
  strength: number
  setStrength(value: number): void
  apply(frame: unknown, deltaTime?: number): void
}>

export type PostProcessFn = (frame: unknown, deltaTime: number) => void

// ---------------------------------------------------------------- renderer

export interface AbiRenderer {
  readonly width: number
  readonly height: number
  setTerminalTitle(title: string): void
  addPostProcessFn(fn: PostProcessFn): void
  removePostProcessFn(fn: PostProcessFn): void
  requestRender(): void
}

// ---------------------------------------------------------------- keymap

export type AbiKeyEvent = Readonly<{
  name: string
  sequence: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  eventKind: "key" | "press" | "release" | "repeat"
}>

export type AbiCommand = Readonly<{
  name: string
  title?: string
  description?: string
  category?: string
  namespace?: string
  enabled?: () => boolean
  run?: () => void | Promise<void>
}>

export type AbiLayer = Readonly<{
  id?: string
  commands?: readonly AbiCommand[]
  bindings?: Readonly<Record<string, string | string[] | false>>
  priority?: number
  enabled?: () => boolean
}>

export interface AbiKeymap {
  registerLayer(layer: AbiLayer): () => void
  registerCommand(command: AbiCommand): () => void
  dispatchCommand(name: string): boolean | Promise<boolean>
  getCommandBindings(
    input: Readonly<{ visibility?: string; commands?: readonly string[] }>,
  ): ReadonlyMap<string, readonly string[]>
  formatBindings(bindings: readonly string[] | undefined): string | undefined
  formatSequence(parts: readonly string[] | undefined): string
}

// Binding lookup helper (`createBindingLookup` in @opentui/keymap/extras):
// command-name -> binding sequence config with namespace-scoped gather. OpenTUI
// 0.4.5 semantics: one `{ key, cmd }` entry per key, array values expanded in
// order, `false`/missing values skipped, command order preserved.
export type AbiBindingEntry = Readonly<{ key: string; cmd: string }>

export interface AbiBindingLookup {
  gather(namespace: string, commands: readonly string[]): AbiBindingEntry[]
  get(command: string): AbiBindingEntry[]
  has(command: string): boolean
  readonly config: Readonly<Record<string, string | string[] | false>>
}

// ---------------------------------------------------------------- surface

export interface EngineSurface {
  readonly abiVersion: typeof TUI_ABI_VERSION
  readonly renderer: AbiRenderer
  readonly keymap: AbiKeymap
  color(input: string | readonly number[] | AbiColorLike): AbiColorLike
  vignette(strength?: number): AbiEffect
  formatKeyEvent(event: AbiKeyEvent): string
  createBindingLookup(config: Readonly<Record<string, string | string[] | false>>): AbiBindingLookup
}
