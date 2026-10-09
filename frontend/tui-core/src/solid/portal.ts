import { createEffect, onCleanup } from "solid-js"
import { Renderable } from "../layout/engine"
import { TextNodeRenderable } from "../primitives/text"
import { useTui } from "./mount"

function resolve(value: unknown, depth = 4): unknown {
  let current = value
  while (depth-- > 0 && typeof current === "function") current = (current as () => unknown)()
  return current
}

// Mounts its children into the renderer's overlay layer (top paint order,
// immune to the surrounding tree's clipping) while reserving a placeholder at
// the original JSX position. Dialog stacks and dropdowns use this to float
// above everything else. Control-flow components (Show/Switch) surface as
// accessors, so children are resolved through them.
export function Portal(props: { children?: unknown }): Renderable {
  const ctx = useTui()
  const placeholder = new TextNodeRenderable("")
  placeholder.visible = false
  createEffect(() => {
    const raw = resolve(props.children)
    const list = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]).filter(
      (item): item is Renderable => item instanceof Renderable,
    )
    for (const item of list) ctx.renderer.overlays.addChild(item)
    onCleanup(() => {
      for (const item of list) ctx.renderer.overlays.removeChild(item)
    })
  })
  return placeholder
}
