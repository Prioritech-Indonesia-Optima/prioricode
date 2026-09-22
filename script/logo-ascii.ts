#!/usr/bin/env bun
// Picture → grainy ASCII converter for the Prioritech mark.
//
//   bun script/logo-ascii.ts <png> <cols> [--chars]
//
// Decodes an RGBA PNG (no external deps), crops to the artwork bounding box,
// samples a cols x rows terminal grid (cells are 2:1 tall, so rows = cols *
// aspect / 2), and classifies each cell by its dominant brand color:
//
//   amber  (swoosh, star)  -> accent tones  `* +`
//   dark   (the P body)    -> base tones    `# % & : .`
//   edges / partial cover  -> light tones   `, ' .`
//
// The tone families match logo.ts `tone()` so the renderers keep coloring the
// swoosh in the brand accent. Regenerate the committed art with:
//
//   bun script/logo-ascii.ts branding/prioritech-mark.png 24
//   bun script/logo-ascii.ts branding/prioritech-mark.png 12

import { inflateSync } from "zlib"
import { readFileSync } from "fs"

const file = process.argv[2]
const cols = Number(process.argv[3] ?? 24)
if (!file) {
  console.error("usage: bun script/logo-ascii.ts <png> <cols>")
  process.exit(1)
}

function decodePng(buf: Buffer) {
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString("ascii", pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
      if (data[8] !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error("need 8-bit RGB/RGBA png")
    } else if (type === "IDAT") idat.push(data)
    else if (type === "IEND") break
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  let offset = 0
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++]
    const line = Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const cur = raw[offset + x]
      const a = x >= channels ? line[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let v = cur
      if (filter === 1) v = (cur + a) & 255
      else if (filter === 2) v = (cur + b) & 255
      else if (filter === 3) v = (cur + ((a + b) >> 1)) & 255
      else if (filter === 4) v = (cur + paeth(a, b, c)) & 255
      line[x] = v
    }
    offset += stride
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      out[i] = line[x * channels]
      out[i + 1] = line[x * channels + 1]
      out[i + 2] = line[x * channels + 2]
      out[i + 3] = channels === 4 ? line[x * channels + 3] : 255
    }
    prev = line
  }
  return { width, height, data: out }
}

const { width, height, data } = decodePng(readFileSync(file))
const px = (x: number, y: number) => {
  const i = (y * width + x) * 4
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] / 255 }
}
const kind = (p: { r: number; g: number; b: number; a: number }) =>
  p.a < 0.12 ? "empty" : p.r > 170 && p.g > 90 && p.b < 130 ? "amber" : "dark"

let minX = width,
  minY = height,
  maxX = 0,
  maxY = 0
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
    if (kind(px(x, y)) !== "empty") {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
const bw = maxX - minX + 1
const bh = maxY - minY + 1
const rows = Math.max(1, Math.round((cols * bh) / bw / 2))
const cellW = bw / cols
const cellH = bh / rows

const lines: string[] = []
for (let cy = 0; cy < rows; cy++) {
  let line = ""
  for (let cx = 0; cx < cols; cx++) {
    let amber = 0
    let dark = 0
    const x0 = Math.floor(minX + cx * cellW)
    const x1 = Math.min(width, Math.ceil(minX + (cx + 1) * cellW))
    const y0 = Math.floor(minY + cy * cellH)
    const y1 = Math.min(height, Math.ceil(minY + (cy + 1) * cellH))
    const total = (x1 - x0) * (y1 - y0)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const k = kind(px(x, y))
        if (k === "amber") amber++
        else if (k === "dark") dark++
      }
    const cover = (amber + dark) / total
    if (cover < 0.06) line += " "
    else if (amber >= dark) line += cover > 0.55 ? "*" : cover > 0.18 ? "+" : "."
    else if (cover > 0.72) line += "#"
    else if (cover > 0.45) line += "%"
    else if (cover > 0.22) line += ":"
    else line += "."
  }
  lines.push(line.trimEnd())
}
console.log(JSON.stringify(lines, null, 2))
