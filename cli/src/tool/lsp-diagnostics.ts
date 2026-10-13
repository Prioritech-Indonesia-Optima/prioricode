import * as path from "path"
import { Effect } from "effect"
import { LSP } from "@/lsp/lsp"
import type { Diagnostic } from "@/lsp/client"
import { FSUtil } from "@prioricode/core/fs-util"

export const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export type DiagnosticsReport = {
  /** Formatted block listing LSP errors per file; empty string when there are none. */
  readonly output: string
  /** Raw diagnostics keyed by normalized file path. */
  readonly diagnostics: Record<string, Diagnostic[]>
}

/**
 * Touches each file, collects diagnostics, and formats a per-file error block.
 */
export function reportDiagnosticsForFiles(
  lsp: LSP.Interface,
  files: string[],
  worktree?: string,
): Effect.Effect<DiagnosticsReport, never, never> {
  return Effect.gen(function* () {
    for (const file of files) {
      yield* lsp.touchFile(file, "document")
    }
    const diagnostics = yield* lsp.diagnostics()
    const lines: string[] = []
    for (const file of files) {
      const normalized = FSUtil.normalizePath(file)
      const block = LSP.Diagnostic.report(file, diagnostics[normalized] ?? [])
      if (!block) continue
      const label = worktree ? path.relative(worktree, file).replaceAll("\\", "/") : file
      lines.push(`LSP errors detected in ${label}, please fix:\n${block}`)
    }
    return { output: lines.join("\n\n"), diagnostics }
  })
}

export * as LspDiagnostics from "./lsp-diagnostics"
