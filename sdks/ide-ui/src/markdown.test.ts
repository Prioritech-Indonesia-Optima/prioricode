import { describe, expect, it } from "bun:test"
import { renderMarkdown, escapeHtml } from "./markdown"

describe("renderMarkdown safety", () => {
  it("escapes raw HTML from model output", () => {
    const html = renderMarkdown("<img src=x onerror=alert(1)> <script>alert(2)</script>")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("<script")
    expect(html).toContain("&lt;img")
  })

  it("only allows http(s) links", () => {
    const js = renderMarkdown("[x](javascript:alert(1))")
    expect(js).not.toContain("<a")
    const data = renderMarkdown("[x](data:text/html,hack)")
    expect(data).not.toContain("<a")
    expect(renderMarkdown("[x](https://example.com/a)")).toContain('href="https://example.com/a"')
  })

  it("keeps code fences LTR-isolated and escaped", () => {
    const html = renderMarkdown("```ts\nconst x = 1 < 2 && a > b\n```")
    expect(html).toContain('<pre class="code-block" dir="ltr">')
    expect(html).toContain("language-ts")
    expect(html).toContain("1 &lt; 2 &amp;&amp; a &gt; b")
  })

  it("renders lists, headings, quotes, inline marks", () => {
    const html = renderMarkdown(
      "# Title\n\n- one\n- two\n\n1. first\n\n> quoted **bold**\n\n`code` and *em* and ~~del~~",
    )
    expect(html).toContain("<h3")
    expect(html).toContain("<ul")
    expect(html).toContain("<ol")
    expect(html).toContain("<blockquote")
    expect(html).toContain("<strong>bold</strong>")
    expect(html).toContain("<code")
    expect(html).toContain("<em>em</em>")
    expect(html).toContain("<del>del</del>")
  })

  it("handles unterminated fence and CRLF", () => {
    const html = renderMarkdown("before\r\n```py\nprint(1)\r\n")
    expect(html).toContain("before")
    expect(html).toContain("print(1)")
  })

  it("survives fuzzed input without producing raw tags or throwing", () => {
    const alphabet = "abc<>[]()`*~#-!\"'\\&;01 \n\r\t/{}<>=_+.,|:$https://x‏مرحبا"
    for (let seed = 0; seed < 400; seed++) {
      let input = ""
      let value = seed * 2654435761
      for (let i = 0; i < 160; i++) {
        value = (value * 1103515245 + 12345) & 0x7fffffff
        input += alphabet[value % alphabet.length]
      }
      const html = renderMarkdown(input)
      expect(html).not.toContain("<script")
      expect(html).not.toContain("onerror=")
      expect(html).not.toContain("javascript:")
    }
  })
})

describe("escapeHtml", () => {
  it("escapes all dangerous characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;")
  })
})
