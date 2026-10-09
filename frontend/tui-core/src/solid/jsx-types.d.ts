import type { Renderable } from "../layout/engine"
import type { BoxStyle, TextStyleProps } from "../types"
import type { ScrollBoxProps } from "../primitives/scroll"

export namespace JSX {
  // `any` keeps solid-js control-flow generics (For/Show children) interoperable with
  // node types from this namespace across the bridge during migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Element = any
  interface ElementChildrenAttribute {
    children: Record<string, never>
  }
  interface IntrinsicElements {
    box: BoxProps
    text: TextProps
    span: SpanProps
    scrollbox: ScrollBoxElementProps
    input: Record<string, unknown>
    textarea: Record<string, unknown>
  }
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

export type ScrollBoxElementProps = ScrollBoxProps &
  Readonly<{
    ref?: (el: Renderable) => void
    children?: unknown
    [key: string]: unknown
  }>
