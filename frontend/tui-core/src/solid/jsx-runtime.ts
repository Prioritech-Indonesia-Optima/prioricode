import type { Renderable } from "../layout/engine"
import { createComponent, createElement, spread } from "./renderer"

export type { JSX, BoxProps, TextProps, SpanProps } from "./jsx-types"

type JsxComponent = (props: Record<string, unknown>) => Renderable

export function jsx(type: string | JsxComponent, props?: Record<string, unknown> | null): Renderable {
  if (typeof type === "function") return createComponent(type, props ?? {})
  const element = createElement(String(type))
  spread(element, props ?? {})
  return element
}

export const jsxs = jsx

export function jsxDEV(type: string | JsxComponent, props?: Record<string, unknown> | null): Renderable {
  return jsx(type, props)
}

export function Fragment(props: { children?: unknown }): unknown {
  return props.children ?? null
}
