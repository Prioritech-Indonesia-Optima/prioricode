import { expect, test } from "bun:test"
import { inflateSync } from "node:zlib"
import { dibToPng, encodePng, parseFileDrop, pickDroppedFile } from "../src/clipboard-win32"

function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function decodePng(png: Buffer) {
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
  let offset = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString("ascii", offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    const crc = png.readUInt32BE(offset + 8 + length)
    expect(crc32(png.subarray(offset + 4, offset + 8 + length))).toBe(crc)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      expect(data[8]).toBe(8)
      expect(data[9]).toBe(6)
    }
    if (type === "IDAT") idat.push(Buffer.from(data))
    if (type === "IEND") break
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(raw[y * (1 + width * 4)]).toBe(0)
    raw.copy(rgba, y * width * 4, y * (1 + width * 4) + 1, y * (1 + width * 4) + 1 + width * 4)
  }
  return { width, height, rgba }
}

function header(
  fields: { width: number; height: number; bitCount: number; compression?: number; size?: number; colorsUsed?: number },
) {
  const buffer = Buffer.alloc(40)
  buffer.writeUInt32LE(fields.size ?? 40, 0)
  buffer.writeInt32LE(fields.width, 4)
  buffer.writeInt32LE(fields.height, 8)
  buffer.writeUInt16LE(1, 12)
  buffer.writeUInt16LE(fields.bitCount, 14)
  buffer.writeUInt32LE(fields.compression ?? 0, 16)
  buffer.writeUInt32LE(0, 20)
  buffer.writeUInt32LE(fields.colorsUsed ?? 0, 24)
  return buffer
}

function withSizeImage(dib: Buffer, size: number) {
  dib.writeUInt32LE(size, 20)
  return dib
}

test("encodes 24-bit bottom-up DIB to RGBA PNG", () => {
  // 2x2 image; bottom-up rows: first stored row is the bottom one.
  const dib = Buffer.concat([
    header({ width: 2, height: 2, bitCount: 24 }),
    Buffer.from([
      // bottom row: black, white (BGR, padded to 4-byte rows of 8)
      0, 0, 0, 255, 255, 255, 0, 0,
      // top row: red, green
      0, 0, 255, 0, 255, 0, 0, 0,
    ]),
  ])
  const png = dibToPng(dib)?.data
  expect(png).toBeDefined()
  const image = decodePng(png!)
  expect(image.width).toBe(2)
  expect(image.height).toBe(2)
  expect([...image.rgba.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  expect([...image.rgba.subarray(8, 16)]).toEqual([0, 0, 0, 255, 255, 255, 255, 255])
})

test("honors top-down negative height", () => {
  const dib = Buffer.concat([
    header({ width: 2, height: -2, bitCount: 24 }),
    Buffer.from([
      0, 0, 255, 0, 255, 0, 0, 0, // stored first = top row: red, green
      0, 0, 0, 255, 255, 255, 0, 0, // bottom row: black, white
    ]),
  ])
  const image = decodePng(dibToPng(dib)!.data)
  expect([...image.rgba.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
})

test("treats 32-bit BI_RGB as opaque", () => {
  const dib = Buffer.concat([
    header({ width: 1, height: 1, bitCount: 32 }),
    Buffer.from([10, 20, 30, 0]),
  ])
  const image = decodePng(dibToPng(dib)!.data)
  expect([...image.rgba]).toEqual([30, 20, 10, 255])
})

test("keeps alpha for V5 bitfields headers", () => {
  const five = Buffer.alloc(124)
  five.writeUInt32LE(124, 0)
  five.writeInt32LE(1, 4)
  five.writeInt32LE(-1, 8)
  five.writeUInt16LE(1, 12)
  five.writeUInt16LE(32, 14)
  five.writeUInt32LE(3, 16)
  five.writeUInt32LE(0x00ff0000, 40)
  five.writeUInt32LE(0x0000ff00, 44)
  five.writeUInt32LE(0x000000ff, 48)
  five.writeUInt32LE(0xff000000, 52)
  five.writeInt32LE(0, 20)
  five.writeUInt32LE(4, 20)
  const dib = Buffer.concat([five, Buffer.from([10, 20, 30, 128])])
  const image = decodePng(dibToPng(dib)!.data)
  expect([...image.rgba]).toEqual([30, 20, 10, 128])
})

test("decodes 8-bit palette DIBs", () => {
  const dib = Buffer.concat([
    header({ width: 2, height: 1, bitCount: 8, colorsUsed: 3 }),
    Buffer.from([0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0]),
    Buffer.from([1, 2, 0, 0]),
  ])
  const image = decodePng(dibToPng(dib)!.data)
  expect([...image.rgba.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
})

test("passes through embedded BI_PNG payloads", () => {
  const payload = encodePng(1, 1, Buffer.from([1, 2, 3, 255]))
  const dib = withSizeImage(
    Buffer.concat([header({ width: 1, height: 1, bitCount: 32, compression: 5 }), payload]),
    payload.length,
  )
  const result = dibToPng(dib)
  expect(result?.mime).toBe("image/png")
  expect(result?.data.toString("hex")).toBe(payload.toString("hex"))
})

test("rejects truncated or unsupported DIBs", () => {
  expect(dibToPng(Buffer.alloc(10))).toBeUndefined()
  expect(dibToPng(Buffer.concat([header({ width: 8, height: 8, bitCount: 24 }), Buffer.alloc(8)]))).toBeUndefined()
  expect(dibToPng(header({ width: 2, height: 2, bitCount: 16 }))).toBeUndefined()
  expect(dibToPng(header({ width: 2, height: 2, bitCount: 24, compression: 1 }))).toBeUndefined()
})

function dropfiles(files: string[]) {
  const list = files.map((file) => Buffer.from(`${file}\0`, "utf16le"))
  const head = Buffer.alloc(20)
  head.writeUInt32LE(20, 0)
  head.writeUInt32LE(1, 16)
  return Buffer.concat([head, ...list, Buffer.alloc(2)])
}

test("parses CF_HDROP wide file lists", () => {
  expect(parseFileDrop(dropfiles(["C:\\shots\\a.png", "C:\\notes.txt"]))).toEqual([
    "C:\\shots\\a.png",
    "C:\\notes.txt",
  ])
  expect(parseFileDrop(Buffer.alloc(0))).toEqual([])
})

test("prefers image/PDF files among dropped paths", () => {
  expect(pickDroppedFile(["C:\\dir\\note.txt", "C:\\dir\\Shot.PNG"])).toBe("C:\\dir\\Shot.PNG")
  expect(pickDroppedFile(["C:\\dir\\note.txt"])).toBe("C:\\dir\\note.txt")
  expect(pickDroppedFile([])).toBeUndefined()
})
