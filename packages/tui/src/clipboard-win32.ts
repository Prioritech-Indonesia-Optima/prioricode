import { deflateSync } from "node:zlib"
import { dlopen, toBuffer } from "bun:ffi"

// `toBuffer` accepts numeric addresses at runtime but its branded type only
// mentions Pointer objects; clipboard handles arrive as plain numbers.
function view(address: number, length: number) {
  return toBuffer(address as unknown as Parameters<typeof toBuffer>[0], length)
}

const CF_DIB = 8
const CF_UNICODETEXT = 13
const CF_HDROP = 15
const CF_DIBV5 = 17

const BI_RGB = 0
const BI_BITFIELDS = 3
const BI_JPEG = 4
const BI_PNG = 5

const GMEM_MOVEABLE = 0x0002

export const DROP_MIMES: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write(type, 4, "ascii")
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length)
  return chunk
}

export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

/**
 * Convert a Windows clipboard DIB (CF_DIB / CF_DIBV5 payload) into PNG bytes.
 * Returns undefined for layouts we do not decode (unknown compression,
 * missing palettes, truncated buffers, absurd dimensions).
 */
export function dibToPng(dib: Buffer): Readonly<{ data: Buffer; mime: string }> | undefined {
  if (dib.length < 40) return
  const headerSize = dib.readUInt32LE(0)
  if (headerSize < 40 || headerSize > dib.length) return
  const width = dib.readInt32LE(4)
  const rawHeight = dib.readInt32LE(8)
  const bitCount = dib.readUInt16LE(14)
  const compression = dib.readUInt32LE(16)
  const colorsUsed = dib.readUInt32LE(24)
  if (width <= 0 || width > 0xffff || rawHeight === 0 || Math.abs(rawHeight) > 0xffff) return

  // Some capture tools embed an already-encoded image inside the DIB.
  if (compression === BI_PNG || compression === BI_JPEG) {
    const size = dib.readUInt32LE(20)
    if (size > 0 && headerSize + size <= dib.length)
      return {
        data: dib.subarray(headerSize, headerSize + size),
        mime: compression === BI_PNG ? "image/png" : "image/jpeg",
      }
  }

  if (bitCount !== 1 && bitCount !== 4 && bitCount !== 8 && bitCount !== 24 && bitCount !== 32) return
  if (compression !== BI_RGB && compression !== BI_BITFIELDS) return

  const height = Math.abs(rawHeight)
  const topDown = rawHeight < 0
  let offset = headerSize

  let palette: Buffer | undefined
  if (bitCount <= 8) {
    const entries = colorsUsed > 0 ? colorsUsed : 1 << bitCount
    const paletteBytes = entries * 4
    if (dib.length < offset + paletteBytes) return
    palette = dib.subarray(offset, offset + paletteBytes)
    offset += paletteBytes
  }
  // A BITMAPINFOHEADER carries the bitfields masks after the palette; V4/V5
  // headers already contain them.
  if (compression === BI_BITFIELDS && headerSize === 40 && bitCount === 32) offset += 12

  const rowBytes = (((width * bitCount + 31) >> 5) << 2) & ~3
  if (dib.length < offset + rowBytes * height) return

  const rgba = Buffer.alloc(width * height * 4)
  const usesAlpha = bitCount === 32 && (compression === BI_BITFIELDS || headerSize >= 108)
  for (let y = 0; y < height; y++) {
    const sourceRow = topDown ? y : height - 1 - y
    const rowStart = offset + sourceRow * rowBytes
    const rowEnd = y * width * 4
    for (let x = 0; x < width; x++) {
      const target = rowEnd + x * 4
      if (bitCount === 32) {
        const pixel = rowStart + x * 4
        rgba[target] = dib[pixel + 2]!
        rgba[target + 1] = dib[pixel + 1]!
        rgba[target + 2] = dib[pixel]!
        rgba[target + 3] = usesAlpha ? dib[pixel + 3]! : 255
      } else if (bitCount === 24) {
        const pixel = rowStart + x * 3
        rgba[target] = dib[pixel + 2]!
        rgba[target + 1] = dib[pixel + 1]!
        rgba[target + 2] = dib[pixel]!
        rgba[target + 3] = 255
      } else {
        let index = 0
        if (bitCount === 8) index = dib[rowStart + x]!
        else if (bitCount === 4) index = x % 2 === 0 ? dib[rowStart + (x >> 1)]! >> 4 : dib[rowStart + (x >> 1)]! & 0xf
        else index = (dib[rowStart + (x >> 3)]! >> (7 - (x % 8))) & 1
        const color = index * 4
        rgba[target] = palette![color + 2] ?? 0
        rgba[target + 1] = palette![color + 1] ?? 0
        rgba[target + 2] = palette![color] ?? 0
        rgba[target + 3] = 255
      }
    }
  }
  return { data: encodePng(width, height, rgba), mime: "image/png" }
}

/** Parse a CF_HDROP memory block into its file list. */
export function parseFileDrop(bytes: Buffer): string[] {
  if (bytes.length < 24) return []
  const pFiles = bytes.readUInt32LE(0)
  const wide = bytes.length >= 20 ? bytes.readUInt32LE(16) !== 0 : true
  const start = Math.max(pFiles, 20)
  const files: string[] = []
  if (wide) {
    let cursor = start
    while (cursor + 1 < bytes.length) {
      let end = cursor
      while (end + 1 < bytes.length && bytes.readUInt16LE(end) !== 0) end += 2
      if (end === cursor) break
      files.push(bytes.subarray(cursor, end).toString("utf16le"))
      cursor = end + 2
    }
  } else {
    let cursor = start
    while (cursor < bytes.length) {
      const end = bytes.indexOf(0, cursor)
      if (end === -1 || end === cursor) break
      files.push(bytes.subarray(cursor, end).toString("latin1"))
      cursor = end + 1
    }
  }
  return files.map((file) => file.trim()).filter(Boolean)
}

export function pickDroppedFile(files: string[]): string | undefined {
  for (const file of files) {
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase()
    if (DROP_MIMES[extension]) return file
  }
  return files[0]
}

function kernel32() {
  return dlopen("kernel32.dll", {
    GlobalAlloc: { args: ["u32", "u64"], returns: "u64" },
    GlobalFree: { args: ["u64"], returns: "u64" },
    GlobalLock: { args: ["u64"], returns: "u64" },
    GlobalSize: { args: ["u64"], returns: "u64" },
    GlobalUnlock: { args: ["u64"], returns: "i32" },
  })
}

function user32() {
  return dlopen("user32.dll", {
    CloseClipboard: { args: [], returns: "i32" },
    EmptyClipboard: { args: [], returns: "i32" },
    GetClipboardData: { args: ["u32"], returns: "u64" },
    OpenClipboard: { args: ["u64"], returns: "i32" },
    SetClipboardData: { args: ["u32", "u64"], returns: "u64" },
  })
}

export type Win32Clipboard = Readonly<{
  /** PNG/JPEG base64 from CF_DIBV5/CF_DIB clipboard data. */
  readImage(): { data: string; mime: string } | undefined
  /** First image/PDF file path when the clipboard holds copied files. */
  readDroppedFile(): string | undefined
  readText(): string | undefined
  writeText(text: string): boolean
}>

type Native = Readonly<{ kernel: ReturnType<typeof kernel32>; user: ReturnType<typeof user32> }>

function load(): Native | undefined {
  try {
    return { kernel: kernel32(), user: user32() }
  } catch {
    return undefined
  }
}

let native: Native | undefined | null

function bind(): Native | undefined {
  if (native === undefined) native = load() ?? null
  return native ?? undefined
}

function readMemory(handle: number, consume: (bytes: Buffer) => string | undefined): string | undefined {
  const k = bind()
  if (!k || !handle) return
  const size = Number(k.kernel.symbols.GlobalSize(handle))
  if (!size) return
  const locked = Number(k.kernel.symbols.GlobalLock(handle))
  if (!locked) return
  try {
    return consume(Buffer.from(view(locked, size)))
  } finally {
    k.kernel.symbols.GlobalUnlock(handle)
  }
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * OpenClipboard fails while another process owns the clipboard; a short
 * bounded retry covers transient ownership without blocking the UI
 * meaningfully (5 attempts x 30ms worst case).
 */
export function openClipboardRetry(
  open: () => number,
  wait: (ms: number) => void = sleepSync,
  attempts = 5,
): boolean {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (open()) return true
    if (attempt + 1 < attempts) wait(30)
  }
  return false
}

function withClipboard<T>(run: () => T | undefined): T | undefined {
  const k = bind()
  if (!k) return
  if (!openClipboardRetry(() => k.user.symbols.OpenClipboard(0))) return
  try {
    return run()
  } finally {
    k.user.symbols.CloseClipboard()
  }
}

export function createWin32Clipboard(): Win32Clipboard | undefined {
  if (process.platform !== "win32") return
  if (!bind()) return undefined

  return {
    readImage: () =>
      withClipboard(() => {
        const user = bind()!.user.symbols
        for (const format of [CF_DIBV5, CF_DIB]) {
          const handle = Number(user.GetClipboardData(format))
          if (!handle) continue
          const image = readMemory(handle, (bytes) => {
            const encoded = dibToPng(bytes)
            return encoded ? `${encoded.mime}\n${encoded.data.toString("base64")}` : undefined
          })
          if (!image) continue
          const split = image.indexOf("\n")
          return { mime: image.slice(0, split), data: image.slice(split + 1).replace(/\s+/g, "") }
        }
        return undefined
      }),

    readDroppedFile: () =>
      withClipboard(() => {
        const handle = Number(bind()!.user.symbols.GetClipboardData(CF_HDROP))
        if (!handle) return undefined
        return readMemory(handle, (bytes) => pickDroppedFile(parseFileDrop(bytes)))
      }),

    readText: () =>
      withClipboard(() => {
        const handle = Number(bind()!.user.symbols.GetClipboardData(CF_UNICODETEXT))
        if (!handle) return undefined
        const text = readMemory(handle, (bytes) => bytes.toString("utf16le").split("\0")[0]!.trim())
        return text?.length ? text : undefined
      }),

    writeText: (value: string) => {
      const symbols = bind()
      if (!symbols) return false
      const payload = Buffer.from(`${value}\0`, "utf16le")
      const memory = Number(symbols.kernel.symbols.GlobalAlloc(GMEM_MOVEABLE, BigInt(payload.length)))
      if (!memory) return false
      try {
        const locked = Number(symbols.kernel.symbols.GlobalLock(memory))
        if (!locked) return false
        try {
          view(locked, payload.length).set(payload)
        } finally {
          symbols.kernel.symbols.GlobalUnlock(memory)
        }
        if (!openClipboardRetry(() => symbols.user.symbols.OpenClipboard(0))) return false
        let handled = false
        try {
          symbols.user.symbols.EmptyClipboard()
          handled = Number(symbols.user.symbols.SetClipboardData(CF_UNICODETEXT, memory)) !== 0
        } finally {
          symbols.user.symbols.CloseClipboard()
          // SetClipboardData takes ownership on success; free only when it did not.
          if (!handled) symbols.kernel.symbols.GlobalFree(memory)
        }
        return handled
      } catch {
        return false
      }
    },
  }
}
