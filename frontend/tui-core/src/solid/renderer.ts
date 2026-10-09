import { createRenderer, type RendererOptions } from "solid-js/universal"
import { Renderable } from "../layout/engine"
import { BoxRenderable } from "../primitives/box"
import { SpanRenderable, TextNodeRenderable, TextRenderable } from "../primitives/text"
import type { BorderEdge } from "../types"

const STYLE_KEYS = new Set([
  "display",
  "flexDirection",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "alignItems",
  "alignSelf",
  "justifyContent",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "marginLeft",
  "marginRight",
  "marginTop",
  "marginBottom",
  "gap",
  "overflow",
  "position",
  "top",
  "left",
])

const warned = new Set<string>()

export function createElementTag(tag: string): Renderable {
  switch (tag) {
    case "box":
      return new BoxRenderable()
    case "text":
      return new TextRenderable()
    case "span":
      return new SpanRenderable()
    default:
      throw new Error(`@prioricode/tui-core: unsupported element <${tag}>`)
  }
}

function setProperty(node: Renderable, name: string, value: unknown): void {
  if (name === "ref") {
    ;(value as ((el: Renderable) => void) | undefined)?.(node)
    return
  }
  if (name === "children" || name === "key") return
  if (STYLE_KEYS.has(name)) {
    ;(node.style as Record<string, unknown>)[name] = value
    node.markDirty()
    return
  }
  if (name === "fg" || name === "bg") {
    node.restyle({ [name]: value as string | number })
    return
  }
  if (name === "visible") {
    node.visible = value !== false
    node.markDirty()
    return
  }
  if (node instanceof TextRenderable || node instanceof SpanRenderable) {
    if (name === "content" || name === "text") {
      node.content = value as never
      return
    }
    if (name === "wrap") {
      node.wrap = value as never
      node.markDirty()
      return
    }
    if (name === "textAlign") {
      node.align = value as never
      node.markDirty()
      return
    }
  }
  if (node instanceof BoxRenderable) {
    if (name === "border") {
      node.border = value as BorderEdge | BorderEdge[] | "all"
      node.markDirty()
      return
    }
    if (name === "borderColor") {
      node.borderColor = typeof value === "number" ? value : parseInt(String(value).replace("#", ""), 16)
      node.markDirty()
      return
    }
    if (name === "title") {
      node.title = String(value ?? "")
      node.markDirty()
      return
    }
  }
  if (!warned.has(name)) {
    warned.add(name)
    console.warn(`tui-core solid bridge: ignoring prop "${name}"`)
  }
}

const options: RendererOptions<Renderable> = {
  createElement: (tag) => (tag === "#text" ? new TextNodeRenderable("") : createElementTag(tag)),
  createTextNode: (value) => new TextNodeRenderable(String(value)),
  replaceText: (node, value) => {
    if (node instanceof TextNodeRenderable) {
      node.value = String(value)
      node.markDirty()
    }
  },
  isTextNode: (node) => node instanceof TextNodeRenderable,
  setProperty,
  insertNode: (parent, node, anchor) => parent.insertBefore(node, anchor),
  removeNode: (parent, node) => parent.removeChild(node),
  getParentNode: (node) => node.parent,
  getFirstChild: (node) => node.children[0],
  getNextSibling: (node) => {
    const parent = node.parent
    if (!parent) return undefined
    const index = parent.children.indexOf(node)
    return parent.children[index + 1]
  },
}

export const {
  render: renderSolid,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = createRenderer(options)

