// Text measurement, truncation, and wrapping. Grapheme segmentation uses
// Intl.Segmenter; display width follows the classic East Asian wide and
// zero-width tables with emoji defaults.
import type { TruncateMode, WrapMode } from "./types"

export type { TruncateMode, WrapMode } from "./types"

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })

export function graphemes(str: string): string[] {
  if (!str.length) return []
  const out: string[] = []
  for (const { segment } of segmenter.segment(str)) out.push(segment)
  return out
}

const ZERO_WIDTH_RANGES: [number, number][] = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x07a6, 0x07b0],
  [0x0900, 0x0903],
  [0x093a, 0x093a],
  [0x093c, 0x093c],
  [0x0941, 0x0948],
  [0x094d, 0x094d],
  [0x0951, 0x0957],
  [0x0962, 0x0963],
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x102d, 0x1030],
  [0x1032, 0x1037],
  [0x1039, 0x103a],
  [0x103d, 0x103d],
  [0x1058, 0x1059],
  [0x105e, 0x1060],
  [0x1071, 0x1074],
  [0x1082, 0x1082],
  [0x1085, 0x1086],
  [0x108d, 0x108d],
  [0x135d, 0x135f],
  [0x1712, 0x1714],
  [0x1732, 0x1734],
  [0x1752, 0x1753],
  [0x1772, 0x1773],
  [0x180b, 0x180e],
  [0x18a9, 0x18a9],
  [0x1920, 0x1922],
  [0x1927, 0x1928],
  [0x1932, 0x1932],
  [0x1939, 0x193b],
  [0x1a17, 0x1a18],
  [0x1a1b, 0x1a1b],
  [0x1a56, 0x1a56],
  [0x1a58, 0x1a60],
  [0x1a62, 0x1a62],
  [0x1a65, 0x1a6c],
  [0x1a73, 0x1a7f],
  [0x1ab0, 0x1abe],
  [0x1b00, 0x1b03],
  [0x1b34, 0x1b34],
  [0x1b36, 0x1b3a],
  [0x1b3c, 0x1b3c],
  [0x1b42, 0x1b42],
  [0x1b6b, 0x1b73],
  [0x1b80, 0x1b81],
  [0x1ba2, 0x1ba5],
  [0x1ba8, 0x1ba9],
  [0x1bab, 0x1bad],
  [0x1be6, 0x1be6],
  [0x1be8, 0x1be9],
  [0x1bed, 0x1bed],
  [0x1bef, 0x1bf2],
  [0x1c00, 0x1c23],
  [0x1c2c, 0x1c33],
  [0x1c36, 0x1c37],
  [0x1cd0, 0x1cd2],
  [0x1cd4, 0x1ce8],
  [0x1d00, 0x1d2b],
  [0x1d6b, 0x1d77],
  [0x1d7b, 0x1d82],
  [0x1d85, 0x1d8a],
  [0x1ed0, 0x1ed3],
  [0x1f00, 0x1f07],
  [0x20d0, 0x20f0],
  [0x2cef, 0x2cf1],
  [0x302a, 0x302d],
  [0x3099, 0x309a],
  [0xa66f, 0xa672],
  [0xa674, 0xa67d],
  [0xa69e, 0xa69f],
  [0xa802, 0xa802],
  [0xa806, 0xa806],
  [0xa80b, 0xa80b],
  [0xa823, 0xa827],
  [0xa880, 0xa880],
  [0xa8b4, 0xa8c3],
  [0xa8e0, 0xa8f1],
  [0xa926, 0xa92d],
  [0xa947, 0xa953],
  [0xa980, 0xa983],
  [0xa9b3, 0xa9b3],
  [0xa9b6, 0xa9b9],
  [0xa9bc, 0xa9bc],
  [0xa9e5, 0xa9e5],
  [0xaa29, 0xaa2e],
  [0xaa31, 0xaa32],
  [0xaa35, 0xaa36],
  [0xaa43, 0xaa43],
  [0xaa4c, 0xaa4c],
  [0xaa76, 0xaa76],
  [0xaab0, 0xaab0],
  [0xaab2, 0xaab4],
  [0xaab7, 0xaab8],
  [0xaabe, 0xaabf],
  [0xaac1, 0xaac1],
  [0xaaec, 0xaaed],
  [0xaaf6, 0xaaf6],
  [0xabe5, 0xabe5],
  [0xabe8, 0xabe8],
  [0xabed, 0xabed],
  [0xfb1e, 0xfb1e],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xfeff, 0xfeff],
  [0x101fd, 0x101fd],
  [0x102e0, 0x102e0],
  [0x10376, 0x1037a],
  [0x10a01, 0x10a0f],
  [0x10a38, 0x10a3f],
  [0x11001, 0x11001],
  [0x11038, 0x11046],
  [0x1107f, 0x11081],
  [0x110b3, 0x110b6],
  [0x110b9, 0x110ba],
  [0x11100, 0x11102],
  [0x11127, 0x1112b],
  [0x1112d, 0x11134],
  [0x11173, 0x11173],
  [0x11180, 0x11181],
  [0x111b6, 0x111be],
  [0x1122f, 0x11231],
  [0x11234, 0x11234],
  [0x112df, 0x112df],
  [0x112e3, 0x112ea],
  [0x11300, 0x11301],
  [0x1133c, 0x1133c],
  [0x11340, 0x11340],
  [0x11366, 0x1136c],
  [0x11370, 0x11374],
  [0x11438, 0x1143f],
  [0x11442, 0x11444],
  [0x11446, 0x11446],
  [0x1145e, 0x1145e],
  [0x114b3, 0x114b8],
  [0x114ba, 0x114ba],
  [0x114bf, 0x114c0],
  [0x114c2, 0x114c3],
  [0x115bf, 0x115c0],
  [0x11630, 0x11632],
  [0x1163b, 0x1163d],
  [0x1163f, 0x11640],
  [0x116ab, 0x116ab],
  [0x116ad, 0x116ad],
  [0x116b0, 0x116b4],
  [0x116b6, 0x116b6],
  [0x116b9, 0x116bd],
  [0x11c00, 0x11c00],
  [0x11c38, 0x11c3e],
  [0x11c3f, 0x11c40],
  [0x11c92, 0x11ca7],
  [0x11caa, 0x11cb0],
  [0x11cb2, 0x11cb3],
  [0x11cb5, 0x11cb6],
  [0x166f0, 0x166f0],
  [0x16b30, 0x16b35],
  [0x16b40, 0x16b42],
  [0x16f51, 0x16f51],
  [0x16fe1, 0x16fe2],
  [0x17000, 0x187f7],
  [0x18800, 0x18cd5],
  [0x18d00, 0x18d08],
  [0x1b000, 0x1b152],
  [0x1b164, 0x1b167],
  [0x1b170, 0x1b2fb],
  [0x1bc9d, 0x1bc9e],
  [0x1cf00, 0x1cf2d],
  [0x1cf30, 0x1cf46],
  [0x1d167, 0x1d169],
  [0x1d17b, 0x1d182],
  [0x1d185, 0x1d18b],
  [0x1d1aa, 0x1d1ad],
  [0x1d242, 0x1d244],
  [0x1da00, 0x1da36],
  [0x1da3b, 0x1da6c],
  [0x1da75, 0x1da75],
  [0x1da84, 0x1da84],
  [0x1da9b, 0x1da9f],
  [0x1daa1, 0x1daaf],
  [0x1e8d0, 0x1e8d6],
  [0x1fee0, 0x1fee0],
  [0xe0100, 0xe01ef],
]

const WIDE_RANGES: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6b],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
]

const EMOJI_WIDE: [number, number][] = [
  [0x2600, 0x27bf],
  [0x1f000, 0x1faff],
]

function inRanges(cp: number, ranges: readonly [number, number][]): boolean {
  for (const [lo, hi] of ranges) {
    if (cp < lo) return false
    if (cp <= hi) return true
  }
  return false
}

export function graphemeWidth(grapheme: string): number {
  const first = grapheme.codePointAt(0) ?? 0
  if (first === 0x200d || first === 0xfe0f || first === 0xfe0e) return 0
  if (first < 0x20 || (first >= 0x7f && first <= 0x9f)) return 0
  if (inRanges(first, ZERO_WIDTH_RANGES)) return 0
  if (inRanges(first, WIDE_RANGES) || inRanges(first, EMOJI_WIDE)) return 2
  return 1
}

export function stringWidth(str: string): number {
  let width = 0
  for (const grapheme of graphemes(str)) width += graphemeWidth(grapheme)
  return width
}

export function truncate(str: string, maxWidth: number, mode: TruncateMode = "end", ellipsis = "…"): string {
  if (maxWidth <= 0) return ""
  if (stringWidth(str) <= maxWidth) return str
  const budget = Math.max(0, maxWidth - stringWidth(ellipsis))
  const parts = graphemes(str)
  if (mode === "end") {
    let acc = 0
    let i = 0
    for (; i < parts.length; i++) {
      const w = graphemeWidth(parts[i])
      if (acc + w > budget) break
      acc += w
    }
    return parts.slice(0, i).join("") + ellipsis
  }
  if (mode === "start") {
    let acc = 0
    let i = parts.length - 1
    for (; i >= 0; i--) {
      const w = graphemeWidth(parts[i])
      if (acc + w > budget) break
      acc += w
    }
    return ellipsis + parts.slice(i + 1).join("")
  }
  let acc = 0
  let i = 0
  for (; i < parts.length; i++) {
    const w = graphemeWidth(parts[i])
    if (acc + w > budget / 2) break
    acc += w
  }
  const head = parts.slice(0, i).join("")
  const rest = budget - acc
  let acc2 = 0
  let j = parts.length - 1
  for (; j > i; j--) {
    const w = graphemeWidth(parts[j])
    if (acc2 + w > rest) break
    acc2 += w
  }
  return head + ellipsis + parts.slice(j + 1).join("")
}

export function wrapLines(str: string, width: number, mode: WrapMode = "word"): string[] {
  if (width <= 0) return []
  const out: string[] = []
  for (const paragraph of str.split("\n")) {
    if (mode === "none" || stringWidth(paragraph) <= width) {
      out.push(paragraph)
      continue
    }
    if (mode === "char") {
      let line = ""
      let lineWidth = 0
      for (const grapheme of graphemes(paragraph)) {
        const w = graphemeWidth(grapheme)
        if (lineWidth + w > width) {
          out.push(line)
          line = ""
          lineWidth = 0
        }
        line += grapheme
        lineWidth += w
      }
      out.push(line)
      continue
    }
    let line = ""
    let lineWidth = 0
    for (const token of paragraph.split(/(?<=\s)/)) {
      const w = stringWidth(token)
      if (lineWidth + w <= width) {
        line += token
        lineWidth += w
        continue
      }
      if (line.length) {
        out.push(line)
        line = token.replace(/^\s+/, "")
        lineWidth = stringWidth(line)
        continue
      }
      let part = ""
      let partWidth = 0
      for (const grapheme of graphemes(token)) {
        const gw = graphemeWidth(grapheme)
        if (partWidth + gw > width) {
          out.push(part)
          part = ""
          partWidth = 0
        }
        part += grapheme
        partWidth += gw
      }
      line = part
      lineWidth = partWidth
    }
    if (line.length || !out.length) out.push(line)
  }
  return out
}
