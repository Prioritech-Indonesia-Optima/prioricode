// OpenTUI-backed EngineSurface adapter. Wraps a real @opentui/core CliRenderer
// and the host keymap into the neutral contract, so the existing (v1) runtime
// path keeps its exact behavior while the surface is normalized for testing.
import { RGBA, VignetteEffect } from "@opentui/core"
import { createBindingLookup } from "@opentui/keymap/extras"
import type { PostProcessFn } from "../index.js"

interface RendererLike {
  readonly width: number
  readonly height: number
  setTerminalTitle?(title: string): void
  addPostProcessFn?(fn: (buffer: unknown, deltaTime: number) => void): void
  removePostProcessFn?(fn: (buffer: unknown, deltaTime: number) => void): void
  requestRender?(): void
}

export function createOpenTuiSurface(renderer: RendererLike) {
  return {
    abiVersion: 1 as const,
    renderer: {
      get width() {
        return renderer.width
      },
      get height() {
        return renderer.height
      },
      setTerminalTitle: (title: string) => renderer.setTerminalTitle?.(title),
      addPostProcessFn: (fn: PostProcessFn) => renderer.addPostProcessFn?.(fn as never),
      removePostProcessFn: (fn: PostProcessFn) => renderer.removePostProcessFn?.(fn as never),
      requestRender: () => renderer.requestRender?.(),
    },
    color: (input: unknown) => {
      if (typeof input === "string") return RGBA.fromHex(input)
      if (Array.isArray(input)) {
        const [r, g, b, a] = input
        return a === undefined ? RGBA.fromInts(r, g, b) : RGBA.fromInts(r, g, b, a)
      }
      const value = input as { toInts(): [number, number, number, number] }
      return RGBA.fromInts(...value.toInts())
    },
    vignette: (strength?: number) => new VignetteEffect(strength),
    createBindingLookup: (config: unknown) => createBindingLookup(config as never),
  }
}
