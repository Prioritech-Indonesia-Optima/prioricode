import type { ServerInfo } from "./server"

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

type WebviewFrame =
  | { kind: "ready" }
  | { kind: "retry" }
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
  const coalesceMs = deps.coalesceMs ?? 50
  const controllers = new Map<string, AbortController>()
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
        case "cancel": {
          controllers.get(frame.id)?.abort()
          controllers.delete(frame.id)
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
    },
  }
}
