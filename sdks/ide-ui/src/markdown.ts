const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => escapes[char] ?? char)

const inline = (value: string): string => {
  let html = escapeHtml(value)
  html = html.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code dir="ltr" class="inline-code">${code}</code>`)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text: string, url: string) => `<a href="${url}" rel="noopener noreferrer" target="_blank">${text}</a>`,
  )
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!;:?]|$)/g, "$1<em>$2</em>")
  html = html.replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
  return html
}

/**
 * Minimal safe markdown for chat transcripts: fenced code, headings, lists,
 * blockquotes, rules, and inline code/bold/italic/links/strikethrough.
 * Everything is HTML-escaped before wrapping tags; only http(s) links survive.
 * Model text gets dir="auto"; code stays LTR and isolated (rtl-aware).
 */
export function renderMarkdown(source: string): string {
  const out: string[] = []
  const fence = /```([\w+-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g
  let cursor = 0
  let match: RegExpExecArray | null
  const text = source.replace(/\r\n/g, "\n")

  while ((match = fence.exec(text)) !== null) {
    if (match.index > cursor) out.push(renderProse(text.slice(cursor, match.index)))
    const language = match[1] ? ` class="language-${escapeHtml(match[1])}"` : ""
    out.push(`<pre class="code-block" dir="ltr"><code${language}>${escapeHtml(match[2])}</code></pre>`)
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) out.push(renderProse(text.slice(cursor)))
  return out.join("")
}

function renderProse(source: string): string {
  const lines = source.split("\n")
  const out: string[] = []
  let listType: "ul" | "ol" | undefined
  let paragraph: string[] = []

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = undefined
    }
  }
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p dir="auto">${inline(paragraph.join("\n")).replace(/\n/g, "<br/>")}</p>`)
      paragraph = []
    }
  }

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const quote = /^\s*>\s?(.*)$/.exec(line)

    if (heading) {
      flushParagraph()
      closeList()
      const level = Math.min(6, heading[1].length + 2)
      out.push(`<h${level} dir="auto">${inline(heading[2])}</h${level}>`)
    } else if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushParagraph()
      closeList()
      out.push("<hr/>")
    } else if (quote) {
      flushParagraph()
      closeList()
      out.push(`<blockquote dir="auto">${inline(quote[1])}</blockquote>`)
    } else if (unordered !== null || ordered !== null) {
      flushParagraph()
      const wanted = unordered ? "ul" : "ol"
      if (listType !== wanted) {
        closeList()
        out.push(`<${wanted} dir="auto">`)
        listType = wanted
      }
      out.push(`<li>${inline((unordered ?? ordered)![1])}</li>`)
    } else if (line.trim() === "") {
      flushParagraph()
      closeList()
    } else {
      paragraph.push(line)
    }
  }
  flushParagraph()
  closeList()
  return out.join("\n")
}
