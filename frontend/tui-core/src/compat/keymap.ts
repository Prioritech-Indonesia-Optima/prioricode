// @opentui/keymap-compatible surface for the core engine. Provides the
// command/layer/binding semantics the app relies on; advanced extension
// hooks (registerLayerFields, appendBindingExpander) are no-ops so callers
// can run unchanged during the transition window.
import { createContext, createMemo, createEffect, onCleanup, useContext } from "solid-js"
import { createKeymap, type CommandInfo, type Keymap, type KeymapLayer } from "../keymap/keymap"
import { parseBinding, type Binding } from "../keymap/binding"
import { createBindingLookup } from "./bindings"
import type { KeyEvent } from "../types"

export { createBindingLookup, type BindingLookup } from "./bindings"
export type { CommandInfo, Keymap, KeymapLayer }

export function stringifyKeyStroke(stroke: string): string {
  return parseBinding(stroke)
    .map((b: Binding) => b.seq)
    .join(" ")
}

export function stringifyKeySequence(parts: readonly string[] | undefined): string {
  return (parts ?? []).join(" ")
}

export function formatKeySequence(parts: readonly string[] | undefined): string {
  return (parts ?? []).join(" ")
}

export function formatCommandBindings(bindings: readonly string[] | undefined): string | undefined {
  return bindings && bindings.length ? bindings.join(" | ") : undefined
}

export interface OpenTuiKeymap extends Keymap {
  setData(key: string, value: unknown): void
  getData<T>(key: string): T | undefined
  registerLayerFields(_fields: unknown): void
  appendBindingExpander(_expander: unknown): () => void
  getPendingSequence(): readonly { tokenName: string }[]
  dispatchInput(event: KeyEvent): boolean
}

export function createKeymapFacade(input: Readonly<{ dispatcher?: (name: string, event: KeyEvent | undefined) => boolean }> = {}): OpenTuiKeymap {
  const base = createKeymap(input)
  const data = new Map<string, unknown>()
  return Object.assign(base, {
    setData: (key: string, value: unknown) => void data.set(key, value),
    getData: <T,>(key: string) => data.get(key) as T | undefined,
    registerLayerFields: () => {},
    appendBindingExpander: () => () => {},
    getPendingSequence: () => base.pendingChain().map((name) => ({ tokenName: name })),
    dispatchInput: (event: KeyEvent) => base.dispatch({ kind: "key", ...event }),
  }) as unknown as OpenTuiKeymap
}

export function createDefaultOpenTuiKeymap(
  _renderer?: unknown,
  input: Readonly<{ dispatcher?: (name: string, event: KeyEvent | undefined) => boolean }> = {},
): OpenTuiKeymap {
  return createKeymapFacade(input)
}

export const registerEscapeClearsPendingSequence = (keymap: OpenTuiKeymap) => {
  const off = keymap.registerLayer({
    id: "escape-clears-pending",
    priority: Number.MAX_SAFE_INTEGER,
    bindings: { "escape-clears.escape": "escape" },
    commands: [
      {
        name: "escape-clears.escape",
        run: () => keymap.clearPending(),
      },
    ],
  })
  return off
}

export const registerBackspacePopsPendingSequence = (keymap: OpenTuiKeymap) => {
  const off = keymap.registerLayer({
    id: "backspace-pops-pending",
    priority: Number.MAX_SAFE_INTEGER,
    bindings: { "backspace-pops.backspace": "backspace" },
    commands: [
      {
        name: "backspace-pops.backspace",
        run: () => keymap.clearPending(),
      },
    ],
  })
  return off
}

export const registerCommaBindings = (_keymap: OpenTuiKeymap) => () => {}
export const registerBaseLayoutFallback = (_keymap: OpenTuiKeymap) => () => {}
export const registerTimedLeader = (keymap: OpenTuiKeymap, _options?: unknown) => {
  keymap.leaderTimeoutMs(1000)
  return () => {}
}
export const registerManagedTextareaLayer = (_keymap: OpenTuiKeymap, _input: unknown) => () => {}

const KeymapContext = createContext<OpenTuiKeymap>()

export function KeymapProvider(props: { value: OpenTuiKeymap; children?: unknown }): unknown {
  return KeymapContext.Provider(props as never) as never
}

export function useKeymap(): OpenTuiKeymap {
  const keymap = useContext(KeymapContext)
  if (!keymap) throw new Error("useKeymap must be used within KeymapProvider")
  return keymap
}

export function useKeymapSelector<T>(selector: (keymap: OpenTuiKeymap) => T): () => T {
  const keymap = useKeymap()
  return createMemo(() => selector(keymap))
}

export function useBindings(factory: () => KeymapLayer): void {
  const keymap = useKeymap()
  createEffect(() => {
    const layer = factory()
    const off = keymap.registerLayer(layer)
    onCleanup(off)
  })
}
