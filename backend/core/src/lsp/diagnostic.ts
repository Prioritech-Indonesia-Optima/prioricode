export * as LSPDiagnostic from "./diagnostic"

export interface Position {
  readonly line: number
  readonly character: number
}

export interface Range {
  readonly start: Position
  readonly end: Position
}

/** A language-server diagnostic. Severity follows the LSP convention: 1 error, 2 warning, 3 information, 4 hint. */
export interface Diagnostic {
  readonly range: Range
  readonly message: string
  readonly severity?: number
  readonly source?: string
  readonly code?: number | string
}

const isPosition = (value: unknown): value is Position => {
  if (typeof value !== "object" || value === null) return false
  const position = value as Record<string, unknown>
  return typeof position.line === "number" && typeof position.character === "number"
}

/** Accept the diagnostic shapes servers actually send and drop malformed payloads. */
export function decode(value: unknown): Diagnostic | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const item = value as Record<string, unknown>
  if (typeof item.message !== "string") return undefined
  const range = item.range as Record<string, unknown> | undefined
  if (!range || !isPosition(range.start) || !isPosition(range.end)) return undefined
  return {
    range: { start: range.start, end: range.end },
    message: item.message,
    ...(typeof item.severity === "number" ? { severity: item.severity } : {}),
    ...(typeof item.source === "string" ? { source: item.source } : {}),
    ...(typeof item.code === "number" || typeof item.code === "string" ? { code: item.code } : {}),
  }
}

export function decodeAll(value: unknown): Diagnostic[] {
  if (!Array.isArray(value)) return []
  return value.map(decode).filter((item): item is Diagnostic => item !== undefined)
}

const MAX_PER_FILE = 20

export function pretty(diagnostic: Diagnostic) {
  const severity = { 1: "ERROR", 2: "WARN", 3: "INFO", 4: "HINT" }[diagnostic.severity ?? 1] ?? "ERROR"
  const line = diagnostic.range.start.line + 1
  const col = diagnostic.range.start.character + 1
  return `${severity} [${line}:${col}] ${diagnostic.message}`
}

/** Render error diagnostics for one file as a bounded model-facing block, or empty when there are none. */
export function report(file: string, issues: ReadonlyArray<Diagnostic>) {
  const errors = issues.filter((item) => (item.severity ?? 1) === 1)
  if (errors.length === 0) return ""
  const limited = errors.slice(0, MAX_PER_FILE)
  const more = errors.length - MAX_PER_FILE
  const suffix = more > 0 ? `\n... and ${more} more` : ""
  return `<diagnostics file="${file}">\n${limited.map(pretty).join("\n")}${suffix}\n</diagnostics>`
}
