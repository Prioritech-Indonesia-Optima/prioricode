import { Marked, type Token } from "marked"
import DOMPurify from "dompurify"
import { escapeHtml } from "./highlight"

interface ParserLike {
  parseInline: (tokens: Token[]) => string
}

interface CodeToken {
  text: string
  lang?: string | null
}

interface LinkToken {
  href: string
  title?: string | null
  tokens?: Token[]
}

const onlyHttpLinks = (href: string | null | undefined): boolean => {
  if (href === null || href === undefined) return false
  try {
    const url = new URL(href, "http://localhost")
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:"
  } catch {
    return false
  }
}

const instance = new Marked({ gfm: true, breaks: false })

instance.use({
  renderer: {
    // Raw HTML in model output is escaped outright: markdown content gets no
    // HTML injection surface at all, DOMPurify stays as the second wall.
    html({ text }: { text: string }): string {
      return escapeHtml(text)
    },
    code(this: { parser: ParserLike }, token: CodeToken): string {
      const language = (token.lang ?? "").split(/\s+/)[0] ?? ""
      const dataLang = language.length > 0 ? ` data-lang="${escapeHtml(language)}"` : ""
      return `<div class="gui-code"${dataLang}><pre><code>${escapeHtml(token.text)}</code></pre><button type="button" class="gui-copy" data-copy>Copy</button></div>`
    },
    link(this: { parser: ParserLike }, token: LinkToken): string {
      const label = this.parser.parseInline(token.tokens ?? [])
      if (!onlyHttpLinks(token.href)) return `<span>${label}</span>`
      const safeTitle =
        token.title !== undefined && token.title !== null && token.title.length > 0 ? ` title="${escapeHtml(token.title)}"` : ""
      return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer"${safeTitle}>${label}</a>`
    },
  },
})

export function renderMarkdown(text: string): string {
  const html = instance.parse(text, { async: false })
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["data-lang", "data-copy", "target", "rel"],
    FORBID_TAGS: ["style", "form", "input"],
  })
}
