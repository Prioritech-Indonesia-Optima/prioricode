const DEFAULT_COLOR = -1

export type ColorInput = string | readonly [number, number, number] | readonly [number, number, number, number]

export function parseColor(input: ColorInput | undefined): number {
  if (input === undefined) return DEFAULT_COLOR
  if (typeof input === "string") {
    const hex = input.startsWith("#") ? input.slice(1) : input
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      return (r << 16) | (g << 8) | b
    }
    if (hex.length === 6 || hex.length === 8) {
      const value = Number.parseInt(hex.slice(0, 6), 16)
      return Number.isFinite(value) ? value : DEFAULT_COLOR
    }
    return DEFAULT_COLOR
  }
  const [r = 0, g = 0, b = 0] = input
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

export function colorChannels(packed: number): readonly [number, number, number] {
  return [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff]
}

export function blendColor(base: number, top: number, alpha: number): number {
  if (top === DEFAULT_COLOR || base === DEFAULT_COLOR) return top === DEFAULT_COLOR ? base : top
  if (alpha >= 1) return top
  const [br, bg, bb] = colorChannels(base)
  const [tr, tg, tb] = colorChannels(top)
  const mix = (a: number, b: number) => Math.round(a + (b - a) * alpha)
  return (mix(br, tr) << 16) | (mix(bg, tg) << 8) | mix(bb, tb)
}

export const defaultColor = DEFAULT_COLOR
