import { checksum } from "@prioricode/core/util/encode"
import DOMPurify from "dompurify"
import { parseMarkdown } from "./markdown-worker"

export type MarkdownCacheEntry = {
  raw: string
  hash: string
  html: string
}

const maxEntries = 200
const maxBytes = 16 * 1024 * 1024
const cache = new Map<string, MarkdownCacheEntry>()
let cacheBytes = 0
const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
}

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

export function sanitizeMarkdown(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

export function getCachedMarkdown(key: string) {
  return cache.get(key)
}

export function touchCachedMarkdown(key: string, value: MarkdownCacheEntry) {
  const prev = cache.get(key)
  if (prev) {
    cacheBytes -= prev.raw.length + prev.html.length
    cache.delete(key)
  }

  const size = value.raw.length + value.html.length
  // A single oversized entry would blow the whole budget; keep it out of the cache.
  if (size <= maxBytes) {
    cache.set(key, value)
    cacheBytes += size
  }

  while (cache.size > 1 && (cache.size > maxEntries || cacheBytes > maxBytes)) {
    const first = cache.keys().next()
    if (first.done) return
    const oldest = cache.get(first.value)
    if (oldest) cacheBytes -= oldest.raw.length + oldest.html.length
    cache.delete(first.value)
  }
}

export async function preloadMarkdown(text: string, cacheKey: string) {
  const key = `${cacheKey}:0:full`
  const cached = getCachedMarkdown(key)
  if (cached?.raw === text) {
    touchCachedMarkdown(key, cached)
    return
  }
  const hash = checksum(text)
  if (!hash) return
  touchCachedMarkdown(key, {
    raw: text,
    hash,
    html: sanitizeMarkdown(await parseMarkdown(text)),
  })
}
