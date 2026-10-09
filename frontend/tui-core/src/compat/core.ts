// @opentui/core-compatible runtime values for the PRIORICODE_TUI_ENGINE=core
// cut-over (spec: specs/tui-plugin-abi-census.md). Only the value surface the
// app and plugins actually touch at runtime is provided; type-only imports
// are erased before runtime. Numerics match @opentui/core 0.4.5 exactly.
import { Attr } from "../types"
import { RGBA } from "./rgba"

export { RGBA }
export { RGBA as Color }

export const TextAttributes = {
  None: 0,
  NONE: 0,
  BOLD: Attr.Bold,
  DIM: Attr.Dim,
  ITALIC: Attr.Italic,
  UNDERLINE: Attr.Underline,
  BLINK: Attr.Blink,
  INVERSE: Attr.Inverse,
  HIDDEN: Attr.Hidden,
  STRIKETHROUGH: Attr.Strike,
} as const

export const MouseButton = {
  LEFT: 0,
  MIDDLE: 1,
  RIGHT: 2,
  WHEEL_UP: 4,
  WHEEL_DOWN: 5,
} as const

export type ColorInput = string | number | RGBA | readonly [number, number, number, number?]

export function decodePasteBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
}

export { VignetteEffect } from "./effects"
export { createBindingLookup } from "./bindings"
export { BoxRenderable } from "../primitives/box"
export { TextRenderable, TextNodeRenderable, SpanRenderable } from "../primitives/text"
export { InputRenderable } from "../primitives/input"
export { TextareaRenderable } from "../primitives/textarea"
export { ScrollBoxRenderable } from "../primitives/scroll"
export { Renderable } from "../layout/engine"
