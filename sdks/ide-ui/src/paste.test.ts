import { describe, expect, it } from "bun:test"
import { sniffImageMime, toBase64, validateImage } from "./paste"

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 9, 1, 2, 3])
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(12).fill(7)])
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4, 5, 6])
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50])
const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 104, 101, 105, 99])

describe("sniffImageMime", () => {
  it("detects supported formats from magic bytes", () => {
    expect(sniffImageMime(png)).toBe("image/png")
    expect(sniffImageMime(jpeg)).toBe("image/jpeg")
    expect(sniffImageMime(gif)).toBe("image/gif")
    expect(sniffImageMime(webp)).toBe("image/webp")
    expect(sniffImageMime(heic)).toBeUndefined()
    expect(sniffImageMime(new Uint8Array([1, 2]))).toBeUndefined()
  })
})

describe("validateImage", () => {
  const policy = { maxBytes: 100, allowedMimes: ["image/png", "image/jpeg", "image/gif", "image/webp"] }

  it("accepts a declared allowed type", () => {
    expect(validateImage(png, "image/png", policy)).toEqual({ ok: true, mime: "image/png" })
  })

  it("falls back to sniffing when the declared type lies or is missing", () => {
    expect(validateImage(png, "application/octet-stream", policy)).toEqual({ ok: true, mime: "image/png" })
    expect(validateImage(webp, "", policy)).toEqual({ ok: true, mime: "image/webp" })
    expect(validateImage(webp, "image/heic", policy)).toEqual({ ok: true, mime: "image/webp" })
  })

  it("rejects unsupported types", () => {
    expect(validateImage(heic, "image/heic", policy)).toEqual({ ok: false, reason: "unsupported" })
    expect(validateImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), "", policy)).toEqual({
      ok: false,
      reason: "unsupported",
    })
  })

  it("enforces the size cap before anything else", () => {
    const big = new Uint8Array(101)
    big.set(png)
    expect(validateImage(big, "image/png", policy)).toEqual({ ok: false, reason: "too_large" })
  })
})

describe("toBase64", () => {
  it("round-trips through atob, including chunk boundaries", () => {
    const bytes = new Uint8Array(0x8000 + 7).fill(0xab)
    const encoded = toBase64(bytes)
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
    expect(decoded.length).toBe(bytes.length)
    expect(decoded.every((value) => value === 0xab)).toBe(true)
  })
})
