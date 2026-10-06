export interface MentionRange {
  start: number
  end: number
}

export interface Mention {
  token: string
  path: string
  range?: MentionRange
  index: number
}

const MENTION = /(?:^|[\s([{])@([^\s)\]{},"'#]+)(#L(\d+)(?:-(\d+))?)?/g

/**
 * Parse `@path#Lx[-y]` mention tokens from prompt text. Text is the source of
 * truth (the agent resolves mentions itself); chips are a projection of it.
 */
export function parseMentions(text: string): Mention[] {
  const found: Mention[] = []
  for (const match of text.matchAll(MENTION)) {
    const path = match[1]
    if (path === undefined || path.length === 0) continue
    const start = match[3] !== undefined ? Number(match[3]) : undefined
    const rawEnd = match[4] !== undefined ? Number(match[4]) : start
    const range = start === undefined ? undefined : { start, end: rawEnd ?? start }
    const at = (match.index ?? 0) + match[0].indexOf("@")
    found.push({ token: text.slice(at, (match.index ?? 0) + match[0].length), path, range, index: at })
  }
  return found
}

export function formatMention(path: string, range?: MentionRange): string {
  if (range === undefined) return `@${path}`
  if (range.start === range.end) return `@${path}#L${range.start}`
  return `@${path}#L${range.start}-${range.end}`
}

export function removeMention(text: string, mention: Mention): string {
  const before = text.slice(0, mention.index)
  const after = text.slice(mention.index + mention.token.length)
  const joined = `${before}${after}`.replace(/ {2,}/g, " ")
  return joined
}

/** Active `@query` fragment under the caret, or undefined when not mentioning. */
export function activeMention(text: string, caret: number): { query: string; start: number; end: number } | undefined {
  const head = text.slice(0, caret)
  const at = head.lastIndexOf("@")
  if (at < 0) return undefined
  if (at > 0 && !/[\s([{]/.test(head[at - 1] ?? "")) return undefined
  const fragment = head.slice(at + 1)
  if (/[ \t\n([{]/.test(fragment) || fragment.includes("@") || fragment.includes("#")) return undefined
  return { query: fragment, start: at, end: caret }
}
