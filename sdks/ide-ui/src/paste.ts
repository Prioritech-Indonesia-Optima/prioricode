export interface ImagePolicy {
  maxBytes: number
  allowedMimes: string[]
}

export type ImageRejection = { ok: false; reason: "too_large" | "unsupported" }
export type ImageValidation = { ok: true; mime: string } | ImageRejection

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export const sniffImageMime = (bytes: Uint8Array): string | undefined => {
  if (bytes.length < 12) return undefined
  const ascii = String.fromCharCode(...bytes.subarray(0, 4))
  if (ascii === "\x89PNG") return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (ascii === "GIF8") return "image/gif"
  if (ascii === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp"
  return undefined
}

/**
 * Declared clipboard/file types are unreliable (heic, octet-stream, empty), so
 * trust the declared type only when it is allowed and otherwise sniff magic
 * bytes. The server performs no conversion or size cap on prompt attachments,
 * so the client is the only guardrail.
 */
export const validateImage = (bytes: Uint8Array, declaredMime: string, policy: ImagePolicy): ImageValidation => {
  if (bytes.byteLength > policy.maxBytes) return { ok: false, reason: "too_large" }
  const declared = declaredMime.toLowerCase()
  if (policy.allowedMimes.includes(declared)) return { ok: true, mime: declared }
  const sniffed = sniffImageMime(bytes)
  if (sniffed !== undefined && policy.allowedMimes.includes(sniffed)) return { ok: true, mime: sniffed }
  return { ok: false, reason: "unsupported" }
}
