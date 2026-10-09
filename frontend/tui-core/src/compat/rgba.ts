// OpenTUI-compatible color class for the transition window (census Layer C:
// plugins import `RGBA` as a value). Behavior mirrors @opentui/core 0.4.5:
// fromHex("#5f87ff").toInts() === [95,135,255,255]; channels exposed as
// 0..1 floats; toString is css `rgba(f, f, f, f)` with 2-decimal rounding.
export class RGBA {
  private readonly ints: readonly [number, number, number, number]

  private constructor(r: number, g: number, b: number, a: number) {
    this.ints = [r & 0xff, g & 0xff, b & 0xff, a & 0xff]
  }

  static fromInts(r: number, g: number, b: number, a = 255): RGBA {
    return new RGBA(Math.round(r), Math.round(g), Math.round(b), Math.round(a))
  }

  static fromValues(r: number, g: number, b: number, a = 1): RGBA {
    return new RGBA(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(a * 255))
  }

  static fromHex(hex: string): RGBA {
    const body = hex.startsWith("#") ? hex.slice(1) : hex
    if (body.length === 3) {
      const r = parseInt(body[0] + body[0], 16)
      const g = parseInt(body[1] + body[1], 16)
      const b = parseInt(body[2] + body[2], 16)
      return RGBA.fromInts(r, g, b, 255)
    }
    const r = parseInt(body.slice(0, 2), 16)
    const g = parseInt(body.slice(2, 4), 16)
    const b = parseInt(body.slice(4, 6), 16)
    const a = body.length >= 8 ? parseInt(body.slice(6, 8), 16) : 255
    return RGBA.fromInts(r, g, b, a)
  }

  static clone(other: RGBA): RGBA {
    return RGBA.fromInts(...other.toInts())
  }

  toInts(): [number, number, number, number] {
    return [...this.ints] as [number, number, number, number]
  }

  toHex(): string {
    const [r, g, b] = this.ints
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
  }

  get r(): number {
    return this.ints[0] / 255
  }

  get g(): number {
    return this.ints[1] / 255
  }

  get b(): number {
    return this.ints[2] / 255
  }

  get a(): number {
    return this.ints[3] / 255
  }

  equals(other: RGBA): boolean {
    const o = other.toInts()
    return this.ints.every((value, index) => value === o[index])
  }

  toString(): string {
    const f = (v: number) => (Math.round((v / 255) * 100) / 100).toFixed(2)
    const [r, g, b, a] = this.ints
    return `rgba(${f(r)}, ${f(g)}, ${f(b)}, ${f(a)})`
  }
}
