import type { EngineSurface, AbiRenderer, AbiKeymap, AbiColorLike, AbiEffect, AbiKeyEvent, AbiBindingLookup, PostProcessFn } from "@prioricode/tui-abi"
import { TUI_ABI_VERSION } from "@prioricode/tui-abi"
import type { CoreRenderer } from "../render/renderer"
import type { Keymap, CommandInfo } from "../keymap/keymap"
import type { KeyEvent } from "../types"
import { RGBA } from "../compat/rgba"
import { VignetteEffect } from "../compat/effects"
import { createBindingLookup } from "../compat/bindings"

export function createTuiCoreSurface(input: Readonly<{ renderer: CoreRenderer; keymap: Keymap }>): EngineSurface {
  const wrappers = new Map<PostProcessFn, (buffer: unknown, delta: number) => void>()
  const renderer: AbiRenderer = {
    get width() {
      return input.renderer.columns
    },
    get height() {
      return input.renderer.rows
    },
    setTerminalTitle: (title) => input.renderer.setTerminalTitle(title),
    addPostProcessFn: (fn) => {
      const wrapped = (buffer: unknown, delta: number) => fn(buffer, delta)
      wrappers.set(fn, wrapped)
      input.renderer.addPostProcessFn(wrapped as never)
    },
    removePostProcessFn: (fn) => {
      const wrapped = wrappers.get(fn)
      if (!wrapped) return
      wrappers.delete(fn)
      input.renderer.removePostProcessFn(wrapped as never)
    },
    requestRender: () => input.renderer.scheduler.requestRender(),
  }
  const keymap: AbiKeymap = {
    registerLayer: (layer) => input.keymap.registerLayer(layer as never),
    registerCommand: (command) => input.keymap.registerCommand(command as CommandInfo),
    dispatchCommand: (name) => input.keymap.press(name),
    getCommandBindings: (query) => input.keymap.commandBindings(query.commands ?? []),
    formatBindings: (bindings) => (bindings && bindings.length ? bindings.join(" / ") : undefined),
    formatSequence: (parts) => (parts ?? []).join(" "),
  }
  return {
    abiVersion: TUI_ABI_VERSION,
    renderer,
    keymap,
    color: (value) => toAbiColor(RGBA.fromHex(String(value))),
    vignette: (strength) => toAbiEffect(new VignetteEffect(strength)),
    formatKeyEvent: (event) => formatKeyEvent(event),
    createBindingLookup: (config) => createBindingLookup(config) as unknown as AbiBindingLookup,
  }
}

function toAbiColor(rgba: RGBA): AbiColorLike {
  return {
    r: rgba.r,
    g: rgba.g,
    b: rgba.b,
    a: rgba.a,
    toHex: () => rgba.toHex(),
    toInts: () => rgba.toInts() as readonly [number, number, number, number],
    toString: () => rgba.toString(),
  }
}

function toAbiEffect(effect: VignetteEffect): AbiEffect {
  return {
    kind: "vignette",
    strength: effect.getStrength(),
    setStrength: (value) => effect.setStrength(value),
    apply: (frame, deltaTime) => effect.apply(frame as never, deltaTime),
  }
}

export function formatKeyEvent(event: AbiKeyEvent): string {
  const parts: string[] = []
  if (event.ctrl) parts.push("ctrl")
  if (event.alt) parts.push("alt")
  if (event.shift) parts.push("shift")
  if (event.meta) parts.push("meta")
  parts.push(event.name)
  return parts.join("+")
}

export function keyEventFromAbi(event: AbiKeyEvent): KeyEvent {
  return {
    name: event.name,
    sequence: event.sequence,
    raw: event.sequence,
    eventKind: event.eventKind,
    ctrl: event.ctrl,
    alt: event.alt,
    shift: event.shift,
    meta: event.meta,
  }
}
