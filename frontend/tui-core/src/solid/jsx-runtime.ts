import type { Renderable } from "../layout/engine"
import type { BoxStyle, TextStyleProps } from "../types"
import { createComponent, createElement, spread } from "./renderer"

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

export type BoxProps = BoxStyle &
  Readonly<{
    border?: BoxStyle["border"]
    borderColor?: string | number
    title?: string
    fg?: string | number
    bg?: string | number
    visible?: boolean
    ref?: (el: Renderable) => void
    children?: unknown
    [key: string]: unknown
  }>

export type TextProps = TextStyleProps &
  Readonly<{
    ref?: (el: Renderable) => void
    children?: unknown
    [key: string]: unknown
  }>

export type SpanProps = Readonly<{
  children?: unknown
  style?: { fg?: string | number; bg?: string | number }
  [key: string]: unknown
}>

export namespace JSX {
  type Element = Renderable | unknown | null
  interface ElementChildrenAttribute {
    children: Record<string, never>
  }
  interface IntrinsicElements {
    box: BoxProps
    text: TextProps
    span: SpanProps
  }
}
