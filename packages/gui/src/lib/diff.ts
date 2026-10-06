import { createTwoFilesPatch } from "diff"

export interface DiffLine {
  kind: "add" | "remove" | "context" | "meta"
  text: string
}

export interface DiffStats {
  additions: number
  deletions: number
}

export function computePatch(path: string, oldText: string, newText: string): string {
  return createTwoFilesPatch(path, path, oldText, newText, "before", "after", { context: 3 })
}

export function splitPatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = []
  for (const raw of patch.split("\n")) {
    if (
      raw.startsWith("+++") ||
      raw.startsWith("---") ||
      raw.startsWith("@@") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ")
    ) {
      lines.push({ kind: "meta", text: raw })
    } else if (raw.startsWith("+")) lines.push({ kind: "add", text: raw.slice(1) })
    else if (raw.startsWith("-")) lines.push({ kind: "remove", text: raw.slice(1) })
    else lines.push({ kind: "context", text: raw.startsWith(" ") ? raw.slice(1) : raw })
  }
  return lines
}

export function patchStats(patch: string): DiffStats {
  let additions = 0
  let deletions = 0
  for (const line of splitPatch(patch)) {
    if (line.kind === "add") additions += 1
    if (line.kind === "remove") deletions += 1
  }
  return { additions, deletions }
}

const DIFF_FENCE = /```diff\n([\s\S]*?)(?:```|$)/

/** Pull a ```diff fenced patch out of tool summary/output text. */
export function extractFencedDiff(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const match = DIFF_FENCE.exec(text)
  return match?.[1]
}
