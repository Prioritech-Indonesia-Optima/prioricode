import { blend, contrastRatio, hexToOklch, shift } from "../color"
import { mapV2Semantics } from "./mapping"
import type { ColorValue, HexColor, V2ColorValue } from "../types"

const GREY_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200] as const

const greyRef = (step: number): V2ColorValue => `var(--pc-grey-${step})`

function greyHex(primitives: Record<string, V2ColorValue>, step: number) {
  const hex = primitives[`pc-grey-${step}`]
  if (typeof hex === "string" && hex.startsWith("#")) return hex as HexColor
}

function resolveGreyRef(value: V2ColorValue, primitives: Record<string, V2ColorValue>) {
  const step = value.match(/^var\(--pc-grey-(\d+)\)$/)?.[1]
  if (!step) throw new Error(`Expected grey primitive ref, got ${value}`)
  const hex = greyHex(primitives, Number(step))
  if (!hex) throw new Error(`Missing grey primitive pc-grey-${step}`)
  return hex
}

function pickGrey(primitives: Record<string, V2ColorValue>, background: HexColor, minContrast: number, target: number) {
  const matches = GREY_STEPS.filter((step) => {
    const hex = greyHex(primitives, step)
    return hex && contrastRatio(hex, background) >= minContrast
  })
  if (matches.length === 0) return target
  return matches.reduce((best, step) => (Math.abs(step - target) < Math.abs(best - target) ? step : best))
}

export function mapV2Foreground(
  ink: HexColor,
  isDark: boolean,
  primitives: Record<string, V2ColorValue>,
  overrides: Record<string, ColorValue> = {},
): Record<string, V2ColorValue> {
  const tint = hexToOklch(ink)
  const body = shift(ink, {
    l: isDark ? Math.max(0, 0.88 - tint.l) * 0.4 : -Math.max(0, tint.l - 0.18) * 0.24,
    c: isDark ? 1.04 : 1.02,
  })

  const semantics = mapV2Semantics(isDark)
  const bgBase = resolveGreyRef(semantics["pc-bg-base"], primitives)
  const bgContrast = resolveGreyRef(semantics["pc-bg-contrast"], primitives)
  const bgInverse = resolveGreyRef(semantics["pc-bg-inverse"], primitives)
  const inverseTarget = hexToOklch(bgInverse).l > 0.55 ? 1100 : greyHex(primitives, 50) ? 50 : 100

  return {
    "pc-text-base": isDark ? blend("#ffffff", body, 0.9) : shift(body, { l: -0.07, c: 1.04 }),
    "pc-text-muted": overrides["text-weak"] ?? shift(body, { l: isDark ? -0.11 : 0.11, c: 0.9 }),
    "pc-text-faint": shift(body, { l: isDark ? -0.2 : 0.21, c: isDark ? 0.78 : 0.72 }),
    "pc-icon-base": greyRef(pickGrey(primitives, bgBase, 7, isDark ? 400 : 800)),
    "pc-icon-muted": greyRef(pickGrey(primitives, bgBase, 3, 600)),
    "pc-icon-inverse": greyRef(pickGrey(primitives, bgInverse, 7, inverseTarget)),
    "pc-icon-contrast": greyRef(pickGrey(primitives, bgContrast, 7, 100)),
    "pc-icon-accent": isDark ? "var(--pc-gold-400)" : "var(--pc-gold-700)",
    "pc-icon-accent-hover": isDark ? "var(--pc-gold-300)" : "var(--pc-gold-800)",
  }
}
