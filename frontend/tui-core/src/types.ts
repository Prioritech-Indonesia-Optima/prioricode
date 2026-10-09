export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>

export type Attributes = number

export const Attr = {
  None: 0,
  Bold: 1 << 0,
  Dim: 1 << 1,
  Italic: 1 << 2,
  Underline: 1 << 3,
  Inverse: 1 << 4,
  Strike: 1 << 5,
  Invisible: 1 << 6,
} as const

export type NamedKey =
  | "escape"
  | "enter"
  | "tab"
  | "backspace"
  | "insert"
  | "delete"
  | "left"
  | "right"
  | "up"
  | "down"
  | "pageUp"
  | "pageDown"
  | "home"
  | "end"
  | "capsLock"
  | "numLock"
  | "scrollLock"
  | "printScreen"
  | "pause"
  | "menu"
  | "f1"
  | "f2"
  | "f3"
  | "f4"
  | "f5"
  | "f6"
  | "f7"
  | "f8"
  | "f9"
  | "f10"
  | "f11"
  | "f12"

export type KeyEventType = "key" | "press" | "release" | "repeat"

export type ModifierFlags = number

export const Modifier = {
  Shift: 1,
  Alt: 2,
  Ctrl: 4,
  Super: 8,
  Hyper: 16,
  CapsLock: 32,
  NumLock: 64,
} as const

export type KeyEvent = Readonly<{
  name: string
  sequence: string
  raw: string
  eventKind: KeyEventType
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  super?: boolean
  hyper?: boolean
  option?: boolean
}>

export type MouseEvent = Readonly<{
  type: "down" | "up" | "move" | "drag" | "wheelUp" | "wheelDown" | "wheelLeft" | "wheelRight"
  button: number
  x: number
  y: number
  ctrl: boolean
  alt: boolean
  shift: boolean
}>

export type PasteEvent = Readonly<{ text: string }>

export type FocusEvent = Readonly<{ focused: boolean }>

export type ResizeEvent = Readonly<{ columns: number; rows: number; pixelWidth: number; pixelHeight: number }>

export type InputEvent =
  | (Readonly<{ kind: "key" }> & KeyEvent)
  | (Readonly<{ kind: "mouse" }> & MouseEvent)
  | (Readonly<{ kind: "paste" }> & PasteEvent)
  | (Readonly<{ kind: "focus" }> & FocusEvent)
  | (Readonly<{ kind: "resize" }> & ResizeEvent)
  | (Readonly<{ kind: "osc"; code: number }> & Readonly<{ data: string }>)
  | (Readonly<{ kind: "dcs" }> & Readonly<{ prefix: string; data: string }>)
  | (Readonly<{ kind: "unknown"; data: string }>)

export type OscCapabilities = Readonly<{ osc5522: boolean; osc52: boolean; dcs: boolean }>

export type Style = Readonly<{
  display?: "flex" | "none"
  flexDirection?: "row" | "column"
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number | string
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline"
  justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly"
  alignSelf?: "auto" | "flex-start" | "flex-end" | "center" | "stretch" | "baseline"
  width?: number | string
  height?: number | string
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  marginLeft?: number
  marginRight?: number
  marginTop?: number
  marginBottom?: number
  gap?: number
  overflow?: "visible" | "hidden"
  position?: "relative" | "absolute"
  top?: number
  left?: number
}>

export type TextStyle = Readonly<{
  fg?: string | number
  bg?: string | number
  attributes?: Attributes
  wrap?: WrapMode
  textAlign?: "left" | "center" | "right"
}>

export type WrapMode = "word" | "char" | "none"

export type TruncateMode = "end" | "start" | "middle"

export const WIDTH_AUTO = -1

export type BorderEdge = "top" | "bottom" | "left" | "right"

export type BoxStyle = Style & Readonly<{
  border?: BorderEdge | BorderEdge[] | "all"
  borderColor?: string | number
  borderStyle?: "single"
  title?: string
}>

export type TextMode = "primary" | "prepend" | "append"

export type TextStyleProps = Readonly<{
  content?: string
  fg?: string | number
  bg?: string | number
  attributes?: Attributes
  wrap?: WrapMode
  textAlign?: "left" | "center" | "right"
}>
