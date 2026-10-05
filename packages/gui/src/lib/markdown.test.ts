import { describe, expect, it } from "bun:test"
import { renderMarkdown } from "./markdown"

describe("renderMarkdown", () => {
  it("escapes script and event-handler vectors", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n')
    expect(html).not.toContain("<script")
    expect(html).not.toMatch(/<img[^>]*onerror/i)
    expect(html).toContain("&lt;script&gt;")
  })

  it("refuses javascript: links but keeps http(s) with safe target", () => {
    const js = renderMarkdown("[click](javascript:alert(1))")
    expect(js).not.toContain('href="javascript:')
    expect(js).toContain("<span>click</span>")
    const http = renderMarkdown("[site](https://prioricode.ai)")
    expect(http).toContain('href="https://prioricode.ai"')
    expect(http).toContain('rel="noopener noreferrer"')
    expect(http).toContain('target="_blank"')
  })

  it("renders fenced code as escaped blocks tagged for highlighting", () => {
    const html = renderMarkdown("```ts\nconst x = 1 < 2 && 3 > 0\n```\n")
    expect(html).toContain('class="gui-code"')
    expect(html).toContain('data-lang="ts"')
    expect(html).toContain("&lt;")
    expect(html).toContain("data-copy")
  })

  it("marks streaming-safe headings, lists, and gfm tables", () => {
    const html = renderMarkdown("# Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n")
    expect(html).toContain("<h1>Title</h1>")
    expect(html).toContain("<li>one</li>")
    expect(html).toContain("<table>")
  })

  it("tolerates partial markdown during token streaming", () => {
    const html = renderMarkdown("```python\ndef hello():\n    print(\"hi\")\n``")
    expect(html).toContain("gui-code")
  })
})
