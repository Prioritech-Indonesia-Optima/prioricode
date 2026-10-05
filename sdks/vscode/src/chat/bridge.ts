import type { ServerInfo } from "./server"
import { createWebSocket, type WebSocketFactory } from "./ws-client"

/**
 * Extension-host side of the GUI transport bridge.
 *
 * The webview never touches the network: it relays every `/api/*` request and SSE
 * stream through this module, which owns discovery and the Basic credential. The
 * password is never posted into the webview. Wire protocol counterpart:
 * packages/gui/src/core/transport/bridge.ts
 */

export const BRIDGE_SSE_ROUTE = /^\/api\/(?:event|session\/[^/]+\/event)(\?.*)?$/

export type BridgeConfigStatus = "connecting" | "ready" | "offline" | "auth-mismatch" | "no-cli"

export interface BridgeConfigPayload {
  kind: "config"
  status: BridgeConfigStatus
  baseUrl: string
  directory?: string
  serverLabel?: string
  detail?: string
}

export interface BridgeHostDeps {
  post: (message: unknown) => void
  resolveServer: () => Promise<BridgeServerResult>
  directory: () => string | undefined
  serverLabel?: (url: string) => string | undefined
  openExternal?: (url: string) => void
  getSelection?: () => Promise<{ path: string; start: number; end: number; text?: string } | undefined>
  openFile?: (path: string) => void
  openWebSocket?: WebSocketFactory
  fetchImpl?: typeof fetch
  log?: (message: string) => void
  coalesceMs?: number
}

export type BridgeServerResult =
  | { ok: true; server: ServerInfo }
  | { ok: false; reason: BridgeConfigStatus; detail?: string }

export interface BridgeHost {
  onMessage: (message: unknown) => void
  dispose: () => void
}

const base64ToBytes = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "base64"))

type WebviewFrame =
  | { kind: "ready" }
  | { kind: "retry" }
  | { kind: "openExternal"; url: string }
  | { kind: "selection"; id: string }
  | { kind: "openFile"; path: string }
  | { kind: "pty-open"; id: string; ptyID: string; cursor?: number }
  | { kind: "pty-send"; id: string; dataBase64: string }
  | { kind: "req"; id: string; method: string; path: string; headers?: Record<string, string>; body?: string }
  | { kind: "open"; id: string; path: string }
  | { kind: "cancel"; id: string }

const ALLOWED_PREFIX = "/api/"
const PRINTABLE_PATH = /^[\x20-\x7e]*$/
const FORBIDDEN_HEADERS = new Set(["authorization", "cookie", "host", "origin", "referer"])
const MAX_BODY_BYTES = 16 * 1024 * 1024

const base64 = (bytes: Uint8Array): string => {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return Buffer.from(binary, "binary").toString("base64")
}

const isAllowedPath = (path: unknown): path is string => {
  if (typeof path !== "string") return false
  const pathname = path.split("?")[0] ?? ""
  return pathname.startsWith(ALLOWED_PREFIX) && PRINTABLE_PATH.test(path) && !path.includes("..")
}

export function createBridgeHost(deps: BridgeHostDeps): BridgeHost {
  const fetchImpl = deps.fetchImpl ?? fetch
  const openWebSocket = deps.openWebSocket ?? createWebSocket
  const coalesceMs = deps.coalesceMs ?? 50
  const controllers = new Map<string, AbortController>()
  const ptySockets = new Map<string, { sendBinary: (data: Uint8Array) => void; close: () => void }>()
  let disposed = false
  let lastConfig: string | undefined

  const authHeaders = (server: ServerInfo): Record<string, string> => {
    const headers: Record<string, string> = {}
    if (server.password !== undefined) {
      headers.authorization = `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`
    }
    return headers
  }

  const pushConfig = async (): Promise<void> => {
    const result = await deps.resolveServer()
    if (disposed) return
    const config: BridgeConfigPayload = result.ok
      ? {
          kind: "config",
          status: "ready",
          baseUrl: result.server.url,
          directory: deps.directory(),
          serverLabel: deps.serverLabel?.(result.server.url),
        }
      : { kind: "config", status: result.reason, baseUrl: "", directory: deps.directory(), detail: result.detail }
    const signature = JSON.stringify(config)
    if (signature === lastConfig) return
    lastConfig = signature
    deps.post(config)
  }

  const forwardHeaders = (incoming: Record<string, string> | undefined): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(incoming ?? {})) {
      if (FORBIDDEN_HEADERS.has(key.toLowerCase())) continue
      out[key] = value
    }
    return out
  }

  const handleReq = async (frame: Extract<WebviewFrame, { kind: "req" }>): Promise<void> => {
    const respond = (status: number, headers: Record<string, string>, text?: string, bodyBase64?: string) => {
      deps.post({
        kind: "res",
        id: frame.id,
        status,
        headers,
        ...(text === undefined ? {} : { text }),
        ...(bodyBase64 === undefined ? {} : { bodyBase64 }),
      })
    }
    if (!isAllowedPath(frame.path) || typeof frame.method !== "string") {
      respond(400, { "content-type": "application/json" }, JSON.stringify({ _tag: "InvalidRequest", message: "path not allowed" }))
      return
    }
    const result = await deps.resolveServer()
    if (!result.ok) {
      respond(503, { "content-type": "application/json" }, JSON.stringify({ _tag: "Unavailable", message: result.detail ?? result.reason }))
      return
    }
    const controller = new AbortController()
    controllers.set(frame.id, controller)
    try {
      const response = await fetchImpl(new URL(frame.path, result.server.url).toString(), {
        method: frame.method,
        headers: { ...authHeaders(result.server), ...forwardHeaders(frame.headers) },
        ...(frame.body === undefined ? {} : { body: frame.body }),
        signal: controller.signal,
      })
      const buffer = new Uint8Array(await response.arrayBuffer())
      if (buffer.byteLength > MAX_BODY_BYTES) {
        respond(502, { "content-type": "application/json" }, JSON.stringify({ _tag: "TooLarge", message: "response exceeded bridge limit" }))
        return
      }
      const contentType = response.headers.get("content-type") ?? ""
      const headers: Record<string, string> = {}
      if (contentType) headers["content-type"] = contentType
      if (contentType.includes("json") || contentType.startsWith("text/") || buffer.byteLength === 0) {
        respond(response.status, headers, new TextDecoder().decode(buffer))
      } else {
        respond(response.status, headers, undefined, base64(buffer))
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        deps.log?.(`bridge req ${frame.path} failed: ${String(error)}`)
        respond(502, { "content-type": "application/json" }, JSON.stringify({ _tag: "BridgeTransport", message: String(error) }))
      }
    } finally {
      controllers.delete(frame.id)
    }
  }

  const handleOpen = async (frame: Extract<WebviewFrame, { kind: "open" }>): Promise<void> => {
    if (!BRIDGE_SSE_ROUTE.test(frame.path)) {
      deps.post({ kind: "end", id: frame.id, error: "stream path not allowed" })
      return
    }
    const result = await deps.resolveServer()
    if (!result.ok) {
      deps.post({ kind: "end", id: frame.id, error: result.detail ?? result.reason })
      return
    }
    const controller = new AbortController()
    controllers.set(frame.id, controller)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await fetchImpl(new URL(frame.path, result.server.url).toString(), {
        method: "GET",
        headers: { ...authHeaders(result.server), accept: "text/event-stream" },
        signal: controller.signal,
      })
      if (disposed || !controllers.has(frame.id)) return
      deps.post({
        kind: "open-head",
        id: frame.id,
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") ?? "" },
      })
      if (response.body === null) {
        deps.post({ kind: "end", id: frame.id })
        return
      }
      // Non-OK SSE responses still carry the declared error JSON in the body;
      // pump it so the client can surface tagged failures instead of a hang.
      const reader = response.body.getReader()
      let pending: Uint8Array[] = []
      let pendingBytes = 0
      const flush = () => {
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
        if (pending.length === 0 || !controllers.has(frame.id)) return
        const joined = new Uint8Array(pendingBytes)
        let offset = 0
        for (const part of pending) {
          joined.set(part, offset)
          offset += part.length
        }
        pending = []
        pendingBytes = 0
        deps.post({ kind: "chunk", id: frame.id, dataBase64: base64(joined) })
      }
      while (!disposed && !controller.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        if (value === undefined) continue
        pending.push(value)
        pendingBytes += value.length
        if (pendingBytes >= 64 * 1024) flush()
        else if (timer === undefined) timer = setTimeout(flush, coalesceMs)
      }
      flush()
      if (controllers.has(frame.id)) deps.post({ kind: "end", id: frame.id })
    } catch (error) {
      if (!controller.signal.aborted && !disposed) {
        deps.log?.(`bridge stream ${frame.path} failed: ${String(error)}`)
        if (controllers.has(frame.id)) deps.post({ kind: "end", id: frame.id, error: String(error) })
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      controllers.delete(frame.id)
    }
  }

  const handlePtyOpen = async (frame: Extract<WebviewFrame, { kind: "pty-open" }>): Promise<void> => {
    if (typeof frame.ptyID !== "string" || frame.ptyID.length === 0 || frame.ptyID.includes("..")) {
      deps.post({ kind: "pty-head", id: frame.id, ok: false, error: "invalid pty id" })
      return
    }
    const result = await deps.resolveServer()
    if (!result.ok) {
      deps.post({ kind: "pty-head", id: frame.id, ok: false, error: result.detail ?? result.reason })
      return
    }
    try {
      const serverUrl = new URL(result.server.url)
      const tokenUrl = new URL(`/api/pty/${encodeURIComponent(frame.ptyID)}/connect-token`, result.server.url)
      const directory = deps.directory()
      if (directory !== undefined) tokenUrl.searchParams.set("location[directory]", directory)
      const tokenResponse = await fetchImpl(tokenUrl.toString(), {
        method: "POST",
        headers: { ...authHeaders(result.server), "x-prioricode-ticket": "1" },
      })
      if (!tokenResponse.ok) {
        deps.post({ kind: "pty-head", id: frame.id, ok: false, error: `connect-token http ${tokenResponse.status}` })
        return
      }
      const tokenPayload = (await tokenResponse.json()) as { data?: { ticket?: string } } | { ticket?: string }
      const ticket = ("data" in tokenPayload && tokenPayload.data?.ticket) || ("ticket" in tokenPayload && tokenPayload.ticket) || undefined
      if (typeof ticket !== "string") {
        deps.post({ kind: "pty-head", id: frame.id, ok: false, error: "connect-token malformed" })
        return
      }
      serverUrl.protocol = serverUrl.protocol === "https:" ? "wss:" : "ws:"
      const connectUrl = new URL(`/api/pty/${encodeURIComponent(frame.ptyID)}/connect`, serverUrl.toString())
      connectUrl.searchParams.set("ticket", ticket)
      if (typeof frame.cursor === "number") connectUrl.searchParams.set("cursor", String(frame.cursor))
      if (directory !== undefined) connectUrl.searchParams.set("location[directory]", directory)
      const socket = await openWebSocket(connectUrl.toString())
      if (disposed) {
        socket.close()
        return
      }
      ptySockets.set(frame.id, socket)
      socket.onMessage((data) => {
        if (!ptySockets.has(frame.id)) return
        let binary = ""
        for (const byte of data) binary += String.fromCharCode(byte)
        deps.post({ kind: "chunk", id: frame.id, dataBase64: Buffer.from(binary, "binary").toString("base64") })
      })
      socket.onClose((code) => {
        if (!ptySockets.delete(frame.id)) return
        deps.post({ kind: "pty-closed", id: frame.id, code })
      })
      deps.post({ kind: "pty-head", id: frame.id, ok: true })
    } catch (error) {
      deps.post({ kind: "pty-head", id: frame.id, ok: false, error: String(error) })
    }
  }

  return {
    onMessage: (message) => {
      const frame = message as WebviewFrame | undefined
      if (typeof frame !== "object" || frame === null || typeof frame.kind !== "string") return
      switch (frame.kind) {
        case "ready":
          void pushConfig()
          return
        case "retry":
          lastConfig = undefined
          void pushConfig()
          return
        case "openExternal": {
          if (typeof frame.url !== "string") return
          try {
            const protocol = new URL(frame.url).protocol
            if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") deps.openExternal?.(frame.url)
          } catch {
            // reject malformed URLs quietly
          }
          return
        }
        case "selection": {
          void (async () => {
            try {
              const selection = await deps.getSelection?.()
              deps.post({ kind: "selection-res", id: frame.id, ...(selection ?? {}) })
            } catch {
              deps.post({ kind: "selection-res", id: frame.id })
            }
          })()
          return
        }
        case "openFile": {
          if (typeof frame.path !== "string" || frame.path.includes("\0")) return
          deps.openFile?.(frame.path)
          return
        }
        case "pty-open":
          void handlePtyOpen(frame)
          return
        case "pty-send": {
          const socket = ptySockets.get(frame.id)
          if (socket === undefined || typeof frame.dataBase64 !== "string") return
          socket.sendBinary(base64ToBytes(frame.dataBase64))
          return
        }
        case "cancel": {
          controllers.get(frame.id)?.abort()
          controllers.delete(frame.id)
          ptySockets.get(frame.id)?.close()
          ptySockets.delete(frame.id)
          return
        }
        case "req":
          void handleReq(frame)
          return
        case "open":
          void handleOpen(frame)
          return
      }
    },
    dispose: () => {
      disposed = true
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      for (const socket of ptySockets.values()) socket.close()
      ptySockets.clear()
    },
  }
}
