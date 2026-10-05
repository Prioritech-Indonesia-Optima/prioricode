import type { BundledLanguage, BundledTheme, HighlighterGeneric } from "shiki"

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

const LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "jsonc",
  "bash",
  "shellscript",
  "zsh",
  "python",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "csharp",
  "ruby",
  "php",
  "html",
  "css",
  "scss",
  "yaml",
  "toml",
  "sql",
  "markdown",
  "diff",
  "docker",
  "make",
  "ini",
  "xml",
] as const

const ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  sh: "shellscript",
  zsh: "zsh",
  py: "python",
  golang: "go",
  rs: "rust",
  md: "markdown",
  yml: "yaml",
  shell: "bash",
}

let instance: Promise<Highlighter | undefined> | undefined

// The webview build defines this as "false" and tree-shakes shiki out of the
// single-file bundle (~9 MB of grammars + wasm). Code stays readable uncolored.
const HIGHLIGHT_DISABLED = import.meta.env.VITE_GUI_HIGHLIGHT === "false"

/**
 * Shiki is loaded lazily; a failure (CSP, missing grammar, old server) resolves
 * undefined and callers degrade to plain monospace code — text is never lost.
 */
export function getHighlighter(): Promise<Highlighter | undefined> {
  if (HIGHLIGHT_DISABLED) return Promise.resolve(undefined)
  const current: Promise<Highlighter | undefined> =
    instance ??
    (instance = import("shiki")
      .then(({ createHighlighter }) => createHighlighter({ themes: ["github-light", "github-dark"], langs: [...LANGS] as BundledLanguage[] }))
      .catch(() => undefined))
  return current
}

export function resolveLang(lang: string | undefined): string | undefined {
  if (lang === undefined) return undefined
  const lower = lang.toLowerCase().trim()
  const canonical = ALIASES[lower] ?? lower
  return (LANGS as readonly string[]).includes(canonical) ? canonical : undefined
}

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const LIGHT = "github-light"
const DARK = "github-dark"

/**
 * Returns two tagged <pre class="shiki"> elements (light + dark). Which one is
 * visible is decided by CSS (`.dark` for the web host, `body.vs-dark` inside VS
 * Code), so one render serves both editor themes without re-highlighting.
 */
export async function highlightCode(code: string, lang: string | undefined): Promise<string | undefined> {
  const resolved = resolveLang(lang)
  if (resolved === undefined) return undefined
  const highlighter = await getHighlighter()
  if (highlighter === undefined) return undefined
  try {
    const light = highlighter.codeToHtml(code, { lang: resolved as BundledLanguage, theme: LIGHT as BundledTheme })
    const dark = highlighter.codeToHtml(code, { lang: resolved as BundledLanguage, theme: DARK as BundledTheme })
    return (
      light.replace('class="shiki', 'class="shiki gui-theme-light') +
      dark.replace('class="shiki', 'class="shiki gui-theme-dark')
    )
  } catch {
    return undefined
  }
}

export function escapeHtml(value: string): string {
  return esc(value)
}
