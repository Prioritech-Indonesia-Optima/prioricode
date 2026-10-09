// Command registry, layered bindings, chain/leader dispatch, and simulation.
// Layers resolve by priority (higher first, registration order breaks ties);
// the first enabled layer defining a command name owns its bindings, and a
// `false` binding disables that command's keys entirely.

import type { InputEvent, KeyEvent } from "../types"
import type { Binding } from "./binding"
import { bindingMatchesEvent, parseBinding } from "./binding"

export type CommandInfo = Readonly<{
  name: string
  title?: string
  description?: string
  category?: string
  enabled?: () => boolean
  run?: () => void | Promise<void>
  suggested?: boolean
  hidden?: boolean
  onSelect?: () => void | Promise<void>
  slash?: Readonly<{ name: string; aliases?: string[] }>
}>

export type CommandDispatcher = (name: string, event: KeyEvent | undefined) => boolean

export type KeymapLayer = Readonly<{
  id: string
  commands?: readonly CommandInfo[]
  bindings?: Readonly<Record<string, string | string[] | false>>
  priority?: number
  enabled?: () => boolean
}>

type ResolvedBinding = Readonly<{ command: string; chain: readonly Binding[] }>

function chainNames(chain: readonly Binding[]): string[] {
  return chain.map((b) => b.name)
}

function namesMatch(names: readonly string[], chain: readonly Binding[], count: number): boolean {
  if (chain.length < count) return false
  for (let i = 0; i < count; i++) if (chain[i].name !== names[i]) return false
  return true
}

export type Keymap = Readonly<{
  registerLayer(layer: KeymapLayer): () => void
  registerCommand(cmd: CommandInfo): () => void
  commandBindings(names: readonly string[]): ReadonlyMap<string, readonly string[]>
  commands(): CommandInfo[]
  dispatch(event: InputEvent): boolean
  press(seq: string): Promise<boolean>
  pendingChain(): string[]
  clearPending(): void
  leaderTimeoutMs(ms: number): void
  setMode(name: string): void
  mode(): string
}>

export function createKeymap(
  input: Readonly<{ dispatcher?: CommandDispatcher }> = {},
): Readonly<{
  registerLayer(layer: KeymapLayer): () => void
  registerCommand(cmd: CommandInfo): () => void
  commandBindings(names: readonly string[]): ReadonlyMap<string, readonly string[]>
  commands(): CommandInfo[]
  dispatch(event: InputEvent): boolean
  press(seq: string): Promise<boolean>
  pendingChain(): string[]
  clearPending(): void
  leaderTimeoutMs(ms: number): void
  setMode(name: string): void
  mode(): string
}> {
  const layers: { layer: KeymapLayer; order: number }[] = []
  const globals: CommandInfo[] = []
  let order = 0
  let pending: { command: string; chain: readonly Binding[]; consumed: number } | null = null
  let timeoutMs = 1000
  let timer: ReturnType<typeof setTimeout> | undefined
  let currentMode = "base"

  function orderedLayers(): KeymapLayer[] {
    return layers
      .slice()
      .sort((a, b) => (b.layer.priority ?? 0) - (a.layer.priority ?? 0) || a.order - b.order)
      .map((entry) => entry.layer)
      .filter((layer) => layer.enabled?.() !== false)
  }

  function commandMap(): Map<string, CommandInfo> {
    const map = new Map<string, CommandInfo>()
    for (const layer of orderedLayers()) {
      for (const cmd of layer.commands ?? []) {
        if (!map.has(cmd.name)) map.set(cmd.name, cmd)
      }
    }
    for (const cmd of globals) {
      if (!map.has(cmd.name)) map.set(cmd.name, cmd)
    }
    return map
  }

  function commandEnabled(name: string): boolean {
    const cmd = commandMap().get(name)
    return cmd === undefined || cmd.enabled?.() !== false
  }

  function activeBindings(): ResolvedBinding[] {
    const out: ResolvedBinding[] = []
    const claimed = new Set<string>()
    for (const layer of orderedLayers()) {
      for (const [command, spec] of Object.entries(layer.bindings ?? {})) {
        if (claimed.has(command)) continue
        claimed.add(command)
        if (spec === false) continue
        for (const seq of typeof spec === "string" ? [spec] : spec) {
          out.push({ command, chain: parseBinding(seq) })
        }
      }
    }
    return out
  }

  function enabledBindings(): ResolvedBinding[] {
    return activeBindings().filter((b) => commandEnabled(b.command))
  }

  function stopTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  function startTimer(): void {
    stopTimer()
    if (pending !== null && timeoutMs > 0) {
      timer = setTimeout(() => {
        pending = null
        timer = undefined
      }, timeoutMs)
    }
  }

  function clearPending(): void {
    pending = null
    stopTimer()
  }

  function runCommand(command: string, event: KeyEvent | undefined): boolean {
    if (!commandEnabled(command)) return false
    if (input.dispatcher !== undefined) return input.dispatcher(command, event)
    const cmd = commandMap().get(command)
    const handler = cmd?.run ?? cmd?.onSelect
    if (handler === undefined) return false
    void Promise.resolve(handler()).catch(() => {})
    return true
  }

  async function runCommandAsync(command: string, event: KeyEvent | undefined): Promise<boolean> {
    if (!commandEnabled(command)) return false
    if (input.dispatcher !== undefined) return input.dispatcher(command, event)
    const cmd = commandMap().get(command)
    const handler = cmd?.run ?? cmd?.onSelect
    if (handler === undefined) return false
    await handler()
    return true
  }

  function dispatchKey(event: KeyEvent): boolean {
    const bindings = enabledBindings()
    if (pending !== null) {
      const consumed = pending
      const advance = bindings.find(
        (b) =>
          b.chain.length > consumed.consumed &&
          namesMatch(chainNames(consumed.chain), b.chain, consumed.consumed) &&
          bindingMatchesEvent(b.chain[consumed.consumed], event),
      )
      if (advance !== undefined) {
        const nextConsumed = consumed.consumed + 1
        if (nextConsumed === advance.chain.length) {
          clearPending()
          return runCommand(advance.command, event)
        }
        pending = { command: advance.command, chain: advance.chain, consumed: nextConsumed }
        startTimer()
        return true
      }
      clearPending()
      // Plain escape only cancels a pending chain; it is not re-dispatched.
      if (event.name.toLowerCase() === "escape" && !event.ctrl && !event.alt && !event.meta) return true
    }
    for (const b of bindings) {
      if (!bindingMatchesEvent(b.chain[0], event)) continue
      if (b.chain.length === 1) return runCommand(b.command, event)
      pending = { command: b.command, chain: b.chain, consumed: 1 }
      startTimer()
      return true
    }
    return false
  }

  function dispatch(event: InputEvent): boolean {
    if (event.kind !== "key") return false
    return dispatchKey(event)
  }

  async function press(seq: string): Promise<boolean> {
    const parts = parseBinding(seq)
    if (parts.length === 0) return false
    const names = parts.map((b) => b.name)
    const bindings = enabledBindings()
    for (const b of bindings) {
      if (b.chain.length === parts.length && namesMatch(names, b.chain, parts.length)) {
        return runCommandAsync(b.command, undefined)
      }
    }
    // A partial sequence arms the pending chain without dispatching, so tests
    // and palette flows can then dispatch the remaining real key events.
    for (const b of bindings) {
      if (b.chain.length > parts.length && namesMatch(names, b.chain, parts.length)) {
        pending = { command: b.command, chain: b.chain, consumed: parts.length }
        startTimer()
        return false
      }
    }
    return false
  }

  return {
    commandBindings(names: readonly string[]) {
      const map = new Map<string, readonly string[]>()
      for (const name of names) {
        const entries: string[] = []
        for (const layer of orderedLayers()) {
          const value = layer.bindings?.[name]
          if (value === undefined || value === false) continue
          if (Array.isArray(value)) entries.push(...value)
          else entries.push(value)
        }
        map.set(name, entries)
      }
      return map
    },
    registerLayer(layer) {
      const entry = { layer, order: order++ }
      layers.push(entry)
      return () => {
        const index = layers.indexOf(entry)
        if (index !== -1) layers.splice(index, 1)
        const active = pending
        if (active !== null) {
          const names = chainNames(active.chain)
          const survives = enabledBindings().some(
            (b) => b.command === active.command && namesMatch(names, b.chain, names.length),
          )
          if (!survives) clearPending()
        }
      }
    },
    registerCommand(cmd) {
      globals.push(cmd)
      return () => {
        const index = globals.indexOf(cmd)
        if (index !== -1) globals.splice(index, 1)
      }
    },
    commands() {
      return [...commandMap().values()]
        .filter((cmd) => cmd.enabled?.() !== false)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    },
    dispatch,
    press,
    pendingChain() {
      if (pending === null) return []
      return chainNames(pending.chain).slice(0, pending.consumed)
    },
    clearPending,
    leaderTimeoutMs(ms) {
      timeoutMs = ms
      if (pending !== null) startTimer()
    },
    setMode(name) {
      currentMode = name
    },
    mode() {
      return currentMode
    },
  }
}
