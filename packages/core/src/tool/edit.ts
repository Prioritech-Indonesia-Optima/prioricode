/**
 * Model-facing V2 exact-edit leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as EditTool from "./edit"

import { ToolFailure } from "@prioricode/llm"
import { FileDiff } from "@prioricode/schema/file-diff"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { EditObserver } from "../edit-observer"
import { FileMutation } from "../file-mutation"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "edit"

export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "File path to edit. Relative paths resolve within the active Location. Absolute paths inside that Location are accepted; external absolute paths require external_directory approval.",
  }),
  oldString: Schema.String.annotate({ description: "Exact text to replace" }),
  newString: Schema.String.annotate({ description: "Replacement text, which must differ from oldString" }),
  replaceAll: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Replace all exact occurrences of oldString (default false)",
  }),
})

export const Output = Schema.Struct({
  files: Schema.Array(FileDiff.Info),
  replacements: Schema.Number,
  formatted: Schema.Boolean.pipe(Schema.optional),
  diagnostics: Schema.String.pipe(Schema.optional),
  snapshot: Schema.String.pipe(Schema.optional),
})
export type Output = typeof Output.Type

const normalizeLineEndings = (text: string) => text.replaceAll("\r\n", "\n")
const detectLineEnding = (text: string): "\n" | "\r\n" => (text.includes("\r\n") ? "\r\n" : "\n")
const convertToLineEnding = (text: string, ending: "\n" | "\r\n") =>
  ending === "\n" ? normalizeLineEndings(text) : normalizeLineEndings(text).replaceAll("\n", "\r\n")

const splitBom = (text: string) =>
  text.startsWith("\uFEFF") ? { bom: true, text: text.slice(1) } : { bom: false, text }
const joinBom = (text: string, bom: boolean) => (bom ? `\uFEFF${text}` : text)
const decodeUtf8 = (content: Uint8Array) => {
  const bom = content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
  return { bom, content, text: new TextDecoder().decode(bom ? content.slice(3) : content) }
}

const countOccurrences = (content: string, search: string) => {
  if (search === "") return content.length + 1
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    count++
    offset += search.length
  }
  return count
}

const previewLines = (value: string, prefix: "+" | "-") => {
  const lines = normalizeLineEndings(value).split("\n")
  const shown = lines.slice(0, 6).map((line) => `${prefix}${line.length > 240 ? `${line.slice(0, 240)}...` : line}`)
  if (lines.length > shown.length) shown.push(`${prefix}...`)
  return shown
}

export const toModelOutput = (output: Output, oldString: string, newString: string) => {
  const notes =
    output.diagnostics === undefined
      ? []
      : ["", `LSP errors detected in this file, please fix:\n${output.diagnostics}`]
  return [
    `Edited file successfully: ${output.files[0]?.file}`,
    `Replacements: ${output.replacements}`,
    "```diff",
    ...previewLines(oldString, "-"),
    ...previewLines(newString, "+"),
    "```",
    ...notes,
  ].join("\n")
}


type FuzzyReplacer = (content: string, find: string) => Generator<string>

const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.65
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.65

const levenshtein = (a: string, b: string) => {
  if (a === "" || b === "") return Math.max(a.length, b.length)
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

const popEmptyTail = (lines: string[]) => {
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

const lineSpan = (lines: string[], startLine: number, endLine: number, content: string) => {
  const offsets: number[] = []
  let cursor = 0
  for (const line of lines) {
    offsets.push(cursor)
    cursor += line.length + 1
  }
  const end = endLine + 1 < offsets.length ? offsets[endLine + 1] - 1 : content.length
  return { start: offsets[startLine], end }
}

const lineTrimmedReplacer: FuzzyReplacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = popEmptyTail(find.split("\n"))
  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true
    for (let j = 0; j < searchLines.length; j++) {
      if (originalLines[i + j].trim() !== searchLines[j].trim()) {
        matches = false
        break
      }
    }
    if (matches) {
      const span = lineSpan(originalLines, i, i + searchLines.length - 1, content)
      yield content.substring(span.start, span.end)
    }
  }
}

const blockAnchorReplacer: FuzzyReplacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = popEmptyTail(find.split("\n"))
  if (searchLines.length < 3) return
  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length
  const maxLineDelta = Math.max(1, Math.floor(searchBlockSize * 0.25))

  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) continue
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        const actualBlockSize = j - i + 1
        if (Math.abs(actualBlockSize - searchBlockSize) <= maxLineDelta) candidates.push({ startLine: i, endLine: j })
        break
      }
    }
  }
  if (candidates.length === 0) return

  const middleSimilarity = (startLine: number, endLine: number) => {
    const actualBlockSize = endLine - startLine + 1
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)
    if (linesToCheck <= 0) return 1.0
    let similarity = 0
    for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
      const originalLine = originalLines[startLine + j].trim()
      const searchLine = searchLines[j].trim()
      const maxLen = Math.max(originalLine.length, searchLine.length)
      if (maxLen === 0) continue
      similarity += (1 - levenshtein(originalLine, searchLine) / maxLen) / linesToCheck
      if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) break
    }
    return similarity
  }

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    if (middleSimilarity(startLine, endLine) >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      const span = lineSpan(originalLines, startLine, endLine, content)
      yield content.substring(span.start, span.end)
    }
    return
  }

  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1
  for (const candidate of candidates) {
    const actualBlockSize = candidate.endLine - candidate.startLine + 1
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)
    if (linesToCheck <= 0) {
      if (1.0 > maxSimilarity) {
        maxSimilarity = 1.0
        bestMatch = candidate
      }
      continue
    }
    let similarity = 0
    for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
      const originalLine = originalLines[candidate.startLine + j].trim()
      const searchLine = searchLines[j].trim()
      const maxLen = Math.max(originalLine.length, searchLine.length)
      if (maxLen === 0) continue
      similarity += 1 - levenshtein(originalLine, searchLine) / maxLen
    }
    similarity /= linesToCheck
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const span = lineSpan(originalLines, bestMatch.startLine, bestMatch.endLine, content)
    yield content.substring(span.start, span.end)
  }
}

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()

const whitespaceNormalizedReplacer: FuzzyReplacer = function* (content, find) {
  const normalizedFind = normalizeWhitespace(find)
  const lines = content.split("\n")
  for (const line of lines) {
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
      continue
    }
    if (normalizeWhitespace(line).includes(normalizedFind)) {
      const words = find.trim().split(/\s+/)
      if (words.length > 0) {
        const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
        try {
          const match = line.match(new RegExp(pattern))
          if (match) yield match[0]
        } catch {}
      }
    }
  }
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length).join("\n")
      if (normalizeWhitespace(block) === normalizedFind) yield block
    }
  }
}

const removeIndentation = (text: string) => {
  const lines = text.split("\n")
  const nonEmpty = lines.filter((line) => line.trim().length > 0)
  if (nonEmpty.length === 0) return text
  const minIndent = Math.min(
    ...nonEmpty.map((line) => {
      const match = line.match(/^(\s*)/)
      return match ? match[1].length : 0
    }),
  )
  return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
}

const indentationFlexibleReplacer: FuzzyReplacer = function* (content, find) {
  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")
  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) yield block
  }
}

const unescapeString = (str: string) =>
  str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, captured: string) => {
    switch (captured) {
      case "n":
        return "\n"
      case "t":
        return "\t"
      case "r":
        return "\r"
      case "'":
        return "'"
      case '"':
        return '"'
      case "`":
        return "`"
      case "\\":
        return "\\"
      case "\n":
        return "\n"
      case "$":
        return "$"
      default:
        return match
    }
  })

const escapeNormalizedReplacer: FuzzyReplacer = function* (content, find) {
  const unescapedFind = unescapeString(find)
  if (content.includes(unescapedFind)) yield unescapedFind
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    if (unescapeString(block) === unescapedFind) yield block
  }
}

const trimmedBoundaryReplacer: FuzzyReplacer = function* (content, find) {
  const trimmedFind = find.trim()
  if (trimmedFind === find) return
  if (content.includes(trimmedFind)) yield trimmedFind
  const lines = content.split("\n")
  const findLines = find.split("\n")
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    if (block.trim() === trimmedFind) yield block
  }
}

const contextAwareReplacer: FuzzyReplacer = function* (content, find) {
  const findLines = popEmptyTail(find.split("\n"))
  if (findLines.length < 3) return
  const contentLines = content.split("\n")
  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() !== lastLine) continue
      const blockLines = contentLines.slice(i, j + 1)
      const block = blockLines.join("\n")
      if (blockLines.length === findLines.length) {
        let matching = 0
        let total = 0
        for (let k = 1; k < blockLines.length - 1; k++) {
          const blockLine = blockLines[k].trim()
          const findLine = findLines[k].trim()
          if (blockLine.length > 0 || findLine.length > 0) {
            total++
            if (blockLine === findLine) matching++
          }
        }
        if (total === 0 || matching / total >= 0.5) {
          yield block
          break
        }
      }
      break
    }
  }
}

const isDisproportionateMatch = (search: string, oldString: string) => {
  const oldLines = oldString.split("\n").length
  const searchLines = search.split("\n").length
  if (searchLines >= Math.max(oldLines + 3, oldLines * 2)) return true
  if (oldLines === 1) return false
  return search.trim().length > Math.max(oldString.trim().length + 500, oldString.trim().length * 4)
}

const fuzzyReplacers: FuzzyReplacer[] = [
  lineTrimmedReplacer,
  blockAnchorReplacer,
  whitespaceNormalizedReplacer,
  indentationFlexibleReplacer,
  escapeNormalizedReplacer,
  trimmedBoundaryReplacer,
  contextAwareReplacer,
]

const fuzzyReplace = (content: string, oldString: string, newString: string, replaceAll: boolean) => {
  for (const replacer of fuzzyReplacers) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      if (isDisproportionateMatch(search, oldString))
        return {
          failure:
            "Refusing replacement because the matched span is much larger than oldString. Re-read the file and provide the full exact oldString for the intended replacement.",
        }
      if (replaceAll) return { text: content.replaceAll(search, newString) }
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue
      return { text: content.substring(0, index) + newString + content.substring(index + search.length) }
    }
  }
  return { failure: "Could not find oldString in the file. It must match exactly, including whitespace and indentation." }
}

// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add external formatter command runtime behind the V2 formatter config (LSP formatting already wired).

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const fs = yield* FSUtil.Service
    const permission = yield* PermissionV2.Service
    const observer = yield* EditObserver.Service

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description:
              "Replace exact text in one file. Relative paths resolve within the active Location. Absolute paths inside the Location are accepted. Explicit external absolute paths require external_directory approval before edit approval.",
            input: Input,
            output: Output,
            toModelOutput: ({ input, output }) => [
              { type: "text", text: toModelOutput(output, input.oldString, input.newString) },
            ],
            execute: (input, context) => {
              const unableToEdit = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
                effect.pipe(
                  Effect.mapError((error) =>
                    error instanceof FileMutation.StaleContentError
                      ? new ToolFailure({
                          message: "File changed after permission approval. Read it again before editing.",
                        })
                      : Tool.failure(`Unable to edit ${input.path}`, error),
                  ),
                )

              return Effect.gen(function* () {
                const permissionSource = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }
                if (input.oldString === input.newString) {
                  return yield* new ToolFailure({
                    message: "No changes to apply: oldString and newString are identical.",
                  })
                }
                if (input.oldString === "") {
                  return yield* new ToolFailure({
                    message: "oldString must not be empty. Use write to create or overwrite a file.",
                  })
                }

                const target = yield* unableToEdit(mutation.resolve({ path: input.path, kind: "file" }))
                const external = target.externalDirectory
                if (external) {
                  yield* unableToEdit(
                    permission.assert({
                      ...LocationMutation.externalDirectoryPermission(external),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source: permissionSource,
                    }),
                  )
                }

                yield* unableToEdit(
                  permission.assert({
                    action: "edit",
                    resources: [target.resource],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: permissionSource,
                  }),
                )
                const source = decodeUtf8(yield* unableToEdit(fs.readFile(target.canonical)))
                const ending = detectLineEnding(source.text)
                const oldString = convertToLineEnding(input.oldString, ending)
                const newString = convertToLineEnding(input.newString, ending)
                const exactCount = countOccurrences(source.text, oldString)
                const replaceAll = input.replaceAll === true
                const fuzzy =
                  exactCount === 1 || replaceAll
                    ? { text: replaceAll ? source.text.replaceAll(oldString, newString) : source.text.replace(oldString, newString) }
                    : exactCount > 1
                      ? {
                          failure:
                            "Found multiple exact matches for oldString. Provide more surrounding context or set replaceAll to true.",
                        }
                      : fuzzyReplace(source.text, oldString, newString, replaceAll)
                if (fuzzy.failure !== undefined) return yield* new ToolFailure({ message: fuzzy.failure })
                const replaced = fuzzy.text
                const replacements =
                  exactCount === 1 || exactCount > 1 ? exactCount : source.text === replaced ? 0 : 1
                const counts = diffLines(source.text, replaced).reduce(
                  (result, item) => ({
                    additions: result.additions + (item.added ? (item.count ?? 0) : 0),
                    deletions: result.deletions + (item.removed ? (item.count ?? 0) : 0),
                  }),
                  { additions: 0, deletions: 0 },
                )
                const next = splitBom(replaced)
                const result = yield* unableToEdit(
                  files.writeIfUnchanged({
                    target,
                    expected: source.content,
                    content: joinBom(next.text, source.bom || next.bom),
                  }),
                )
                const observation = yield* observer.afterEdit([result.target])
                return {
                  files: [
                    {
                      file: result.resource,
                      patch: createTwoFilesPatch(result.resource, result.resource, source.text, replaced),
                      status: "modified" as const,
                      ...counts,
                    },
                  ],
                  replacements,
                  ...observation,
                } satisfies Output
              })
            },
          }),
          "edit",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/edit",
  layer,
  deps: [
    ToolRegistry.node,
    LocationMutation.node,
    FileMutation.node,
    FSUtil.node,
    PermissionV2.node,
    EditObserver.node,
  ],
})
