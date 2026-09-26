export * as LSPClient from "./client"

import { spawn } from "cross-spawn"
import type { ChildProcessByStdio } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import fs from "node:fs/promises"
import { pathToFileURL, fileURLToPath } from "node:url"
import { LSPJSONRPC } from "./jsonrpc"
import { LSPLanguage } from "./language"

const INITIALIZE_TIMEOUT_MS = 45_000
const SHUTDOWN_TIMEOUT_MS = 1_000
const DIAGNOSTICS_DEBOUNCE_MS = 150
const INCREMENTAL_SYNC = 2

export interface Position {
  readonly line: number
  readonly character: number
}

export interface Diagnostic {
  readonly range: { readonly start: Position; readonly end: Position }
  readonly message: string
  readonly severity?: number
  readonly source?: string
  readonly code?: number | string
}

export interface Options {
  readonly serverID: string
  readonly command: ReadonlyArray<string>
  readonly cwd: string
  readonly root: string
  readonly env?: Record<string, string> | undefined
  readonly initialization?: Record<string, unknown> | undefined
}

export interface Client {
  readonly serverID: string
  /** Sync the on-disk file with the server; resolves with the document version. */
  readonly open: (file: string) => Promise<number>
  /** Resolve after a fresh diagnostics publish for `version` (debounced) or after the timeout. */
  readonly waitForDiagnostics: (file: string, version: number, after: number, timeoutMs: number) => Promise<void>
  readonly diagnostics: (file: string) => ReadonlyArray<Diagnostic>
  readonly supportsFormatting: () => boolean
  /** Request whole-document formatting and return the formatted text, or `undefined` when unavailable. */
  readonly formatting: (file: string, text: string) => Promise<string | undefined>
  readonly shutdown: () => Promise<void>
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LSP operation timed out after ${ms}ms`)), ms)
    }),
  ])
}

function filePathOf(uri: string) {
  if (!uri.startsWith("file://")) return undefined
  return LSPJSONRPC.normalizePath(fileURLToPath(uri))
}

function endPosition(text: string) {
  const lines = text.split(/\r\n|\r|\n/)
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 }
}

function applyEdits(text: string, edits: ReadonlyArray<{ range: { start: Position; end: Position }; newText: string }>) {
  const lines = text.split("\n")
  const offset = (position: Position) =>
    Math.max(
      0,
      Math.min(
        text.length,
        lines.slice(0, Math.max(0, position.line)).reduce((total, line) => total + line.length + 1, 0) +
          Math.max(0, position.character),
      ),
    )
  return edits
    .map((edit) => ({ start: offset(edit.range.start), end: offset(edit.range.end), newText: edit.newText }))
    .sort((left, right) => right.start - left.start)
    .reduce((result, edit) => result.slice(0, edit.start) + edit.newText + result.slice(edit.end), text)
}

function configurationValue(settings: unknown, section?: string) {
  if (!section) return settings ?? null
  const value = section.split(".").reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object" || !(key in current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, settings)
  return value ?? null
}

const withTimeoutOption = async <T>(promise: Promise<T>, ms: number, fallback: T) =>
  await Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms).unref?.())])

export async function create(options: Options): Promise<Client> {
  const child = spawn(options.command[0], options.command.slice(1), {
    cwd: options.cwd,
    env: { ...globalThis.process.env, ...options.env },
    stdio: ["pipe", "pipe", "ignore"],
  }) as ChildProcessByStdio<Writable, Readable, null>
  if (!child.stdout || !child.stdin) throw new Error(`LSP server ${options.serverID} has no stdio pipes`)

  const connection = new LSPJSONRPC.MessageConnection(child.stdout, child.stdin)
  const published = new Map<string, { at: number; version?: number; items: Diagnostic[] }>()
  const waiters = new Map<string, () => void>()
  const documents = new Map<string, { version: number; text: string }>()
  let syncKind: number | undefined
  let formattingSupported = false

  connection.onNotification("textDocument/publishDiagnostics", (params) => {
    const report = params as { uri?: string; version?: number; diagnostics?: Diagnostic[] }
    const file = report.uri ? filePathOf(report.uri) : undefined
    if (!file) return
    published.set(file, {
      at: Date.now(),
      version: typeof report.version === "number" ? report.version : undefined,
      items: Array.isArray(report.diagnostics) ? report.diagnostics : [],
    })
    waiters.get(file)?.()
  })
  connection.onRequest("workspace/configuration", (params) => {
    const items = (params as { items?: { section?: string }[] }).items ?? []
    return items.map((item) => configurationValue(options.initialization, item.section))
  })
  connection.onRequest("workspace/workspaceFolders", () => [{ name: "workspace", uri: pathToFileURL(options.root).href }])
  connection.onRequest("window/workDoneProgress/create", () => null)
  connection.onRequest("client/registerCapability", () => null)
  connection.onRequest("client/unregisterCapability", () => null)
  connection.onRequest("workspace/diagnostic/refresh", () => null)
  connection.listen()

  try {
    const result = await withTimeout(
      connection.request("initialize", {
        processId: child.pid ?? null,
        rootUri: pathToFileURL(options.root).href,
        workspaceFolders: [{ name: "workspace", uri: pathToFileURL(options.root).href }],
        initializationOptions: options.initialization ?? undefined,
        capabilities: {
          window: { workDoneProgress: true },
          workspace: {
            configuration: true,
            workspaceFolders: true,
            diagnostics: { refreshSupport: false },
          },
          textDocument: {
            synchronization: { didOpen: true, didChange: true },
            publishDiagnostics: { versionSupport: false },
            formatting: { dynamicRegistration: false },
          },
        },
      }),
      INITIALIZE_TIMEOUT_MS,
    )
    const capabilities = (result as { capabilities?: Record<string, unknown> })?.capabilities ?? {}
    const sync = capabilities.textDocumentSync
    syncKind = typeof sync === "number" ? sync : ((sync as { change?: number })?.change ?? undefined)
    formattingSupported = capabilities.documentFormattingProvider === true
  } catch (error) {
    dispose()
    throw error
  }
  connection.notify("initialized", {})
  if (options.initialization) connection.notify("workspace/didChangeConfiguration", { settings: options.initialization })

  function dispose() {
    connection.close()
    try {
      child.stdin.end()
    } catch {}
    child.kill("SIGTERM")
  }

  return {
    serverID: options.serverID,
    async open(file) {
      const text = await fs.readFile(file, "utf8")
      const uri = pathToFileURL(file).href
      const document = documents.get(file)
      if (document === undefined) {
        documents.set(file, { version: 0, text })
        connection.notify("textDocument/didOpen", {
          textDocument: { uri, languageId: LSPLanguage.languageFor(file), version: 0, text },
        })
        return 0
      }
      const version = document.version + 1
      documents.set(file, { version, text })
      connection.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges:
          syncKind === INCREMENTAL_SYNC
            ? [{ range: { start: { line: 0, character: 0 }, end: endPosition(document.text) }, text }]
            : [{ text }],
      })
      return version
    },
    async waitForDiagnostics(file, version, after, timeoutMs) {
      const normalized = LSPJSONRPC.normalizePath(file)
      const fresh = () => {
        const hit = published.get(normalized)
        if (!hit || hit.at < after) return false
        return hit.version === undefined || hit.version >= version
      }
      if (fresh()) {
        await new Promise((resolve) => setTimeout(resolve, DIAGNOSTICS_DEBOUNCE_MS).unref?.())
        return
      }
      await withTimeoutOption(
        new Promise<void>((resolve) => {
          waiters.set(normalized, () => {
            if (!fresh()) return
            waiters.delete(normalized)
            setTimeout(() => resolve(), DIAGNOSTICS_DEBOUNCE_MS).unref?.()
          })
        }),
        Math.max(0, timeoutMs - (Date.now() - after)),
        undefined,
      )
      waiters.delete(normalized)
    },
    diagnostics(file) {
      return published.get(LSPJSONRPC.normalizePath(file))?.items ?? []
    },
    supportsFormatting: () => formattingSupported,
    async formatting(file, text) {
      if (!formattingSupported) return undefined
      try {
        const result = await withTimeout(
          connection.request("textDocument/formatting", {
            textDocument: { uri: pathToFileURL(file).href },
            options: { tabSize: 2, insertSpaces: true },
          }),
          5_000,
        )
        const edits = result as
          | ReadonlyArray<{ range: { start: Position; end: Position }; newText: string }>
          | null
          | undefined
        if (!Array.isArray(edits) || edits.length === 0) return undefined
        return applyEdits(text, edits)
      } catch {
        return undefined
      }
    },
    async shutdown() {
      await withTimeoutOption(connection.request("shutdown", undefined).catch(() => undefined), SHUTDOWN_TIMEOUT_MS, undefined)
      connection.notify("exit")
      await new Promise((resolve) => setTimeout(resolve, 50).unref?.())
      dispose()
    },
  }
}
