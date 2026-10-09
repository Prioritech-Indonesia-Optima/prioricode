import type { Node as YogaNode, Yoga } from "yoga-layout/load"
import type { Style } from "../types"

let yogaModule: Yoga | undefined

export async function ensureYoga(): Promise<Yoga> {
  if (yogaModule) return yogaModule
  const { loadYoga } = await import("yoga-layout/load")
  yogaModule = await loadYoga()
  return yogaModule
}

export function applyStyle(node: YogaNode, style: Style): void {
  const Y = yogaModule
  if (!Y) throw new Error("call ensureYoga() before layout")
  node.setDisplay(style.display === "none" ? Y.DISPLAY_NONE : Y.DISPLAY_FLEX)
  node.setFlexDirection(
    style.flexDirection === "column"
      ? Y.FLEX_DIRECTION_COLUMN
      : style.flexDirection === "column-reverse"
        ? Y.FLEX_DIRECTION_COLUMN_REVERSE
        : style.flexDirection === "row-reverse"
          ? Y.FLEX_DIRECTION_ROW_REVERSE
          : Y.FLEX_DIRECTION_ROW,
  )
  node.setFlexGrow(style.flexGrow ?? 0)
  node.setFlexShrink(style.flexShrink ?? 1)
  if (style.flexBasis !== undefined) {
    if (typeof style.flexBasis === "number") node.setFlexBasis(style.flexBasis)
    else node.setFlexBasisPercent(parseFloat(style.flexBasis))
  } else node.setFlexBasisAuto()
  node.setAlignItems(alignOf(Y, style.alignItems))
  node.setAlignSelf(alignOf(Y, style.alignSelf))
  node.setJustifyContent(justifyOf(Y, style.justifyContent))
  if (style.width !== undefined) setSize(node, "width", style.width)
  if (style.height !== undefined) setSize(node, "height", style.height)
  if (style.minWidth !== undefined) node.setMinWidth(style.minWidth)
  if (style.minHeight !== undefined) node.setMinHeight(style.minHeight)
  if (style.maxWidth !== undefined) node.setMaxWidth(style.maxWidth)
  if (style.maxHeight !== undefined) node.setMaxHeight(style.maxHeight)
  node.setPadding(Y.EDGE_LEFT, style.paddingLeft ?? style.padding ?? 0)
  node.setPadding(Y.EDGE_RIGHT, style.paddingRight ?? style.padding ?? 0)
  node.setPadding(Y.EDGE_TOP, style.paddingTop ?? style.padding ?? 0)
  node.setPadding(Y.EDGE_BOTTOM, style.paddingBottom ?? style.padding ?? 0)
  node.setMargin(Y.EDGE_LEFT, style.marginLeft ?? style.margin ?? 0)
  node.setMargin(Y.EDGE_RIGHT, style.marginRight ?? style.margin ?? 0)
  node.setMargin(Y.EDGE_TOP, style.marginTop ?? style.margin ?? 0)
  node.setMargin(Y.EDGE_BOTTOM, style.marginBottom ?? style.margin ?? 0)
  node.setGap(Y.GUTTER_COLUMN, style.gap ?? 0)
  node.setGap(Y.GUTTER_ROW, style.gap ?? 0)
  node.setPositionType(style.position === "absolute" ? Y.POSITION_TYPE_ABSOLUTE : Y.POSITION_TYPE_RELATIVE)
  if (style.top !== undefined) node.setPosition(Y.EDGE_TOP, style.top)
  if (style.left !== undefined) node.setPosition(Y.EDGE_LEFT, style.left)
  if (style.right !== undefined) node.setPosition(Y.EDGE_RIGHT, style.right)
  if (style.bottom !== undefined) node.setPosition(Y.EDGE_BOTTOM, style.bottom)
}

function setSize(node: YogaNode, axis: "width" | "height", value: number | string): void {
  if (typeof value === "number") {
    if (axis === "width") node.setWidth(value)
    else node.setHeight(value)
    return
  }
  const pct = parseFloat(value)
  if (axis === "width") node.setWidthPercent(pct)
  else node.setHeightPercent(pct)
}

function alignOf(Y: Yoga, value: Style["alignItems"] | Style["alignSelf"]): number {
  switch (value) {
    case "center":
      return Y.ALIGN_CENTER
    case "flex-end":
      return Y.ALIGN_FLEX_END
    case "flex-start":
      return Y.ALIGN_FLEX_START
    case "baseline":
      return Y.ALIGN_BASELINE
    case "stretch":
      return Y.ALIGN_STRETCH
    default:
      return Y.ALIGN_STRETCH
  }
}

function justifyOf(Y: Yoga, value: Style["justifyContent"]): number {
  switch (value) {
    case "center":
      return Y.JUSTIFY_CENTER
    case "flex-end":
      return Y.JUSTIFY_FLEX_END
    case "space-between":
      return Y.JUSTIFY_SPACE_BETWEEN
    case "space-around":
      return Y.JUSTIFY_SPACE_AROUND
    case "space-evenly":
      return Y.JUSTIFY_SPACE_EVENLY
    default:
      return Y.JUSTIFY_FLEX_START
  }
}
