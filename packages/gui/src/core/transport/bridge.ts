/**
 * Webview-side transport bridge.
 *
 * The VS Code webview never touches the network: every request and SSE stream is
 * relayed through the extension host, which owns server discovery and the Basic
 * credential. The generated client is reused unmodified by injecting this module's
 * `fetch` because `PrioriCode.make({ fetch })` is the client's only I/O seam.
 *
 * Wire protocol (postMessage JSON only):
 *   webview -> host: ready | req | open | cancel
 *   host -> webview: config | res | open-head | chunk | end
 *
 * Stream chunks carry base64 of raw bytes so multibyte characters may split
 * across chunk boundaries safely; the SSE framing is parsed downstream by the
 * client exactly as in direct mode.
 */

export const SSE_ROUTE_PATTERN = /^\/api\/(event|session\/[^/]+\/event)(\?.*)?$/

export interface BridgeWebviewApi {
  postMessage: (message: unknown) => void
}

export interface BridgeTargetConfig {
  baseUrl: string
  directory?: string
  serverLabel?: string
}

export type BridgeOutbound =
  | { kind: "ready" }
  | { kind: "req"; id: string; method: string; path: string; headers?: Record<string, string>; body?: string }
  | { kind: "open"; id: string; path: string }
  | { kind: "cancel"; id: string }

export type BridgeInbound =
  | { kind: "config"; baseUrl: string; directory?: string; serverLabel?: string }
  | { kind: "res"; id: string; status: number; headers: Record<string, string>; text?: string; bodyBase64?: string }
  | { kind: "open-head"; id: string; status: number; headers: Record<string, string> }
  | { kind: "chunk"; id: string; dataBase64: string }
  | { kind: "end"; id: string; error?: string }

interface PendingRequest {
  resolve: (response: BridgeInbound & { kind: "res" }) => void
  reject: (error: Error) => void
}

interface PendingStream {
  head: (response: BridgeInbound & { kind: "open-head" }) => void
  controller: ReadableStreamDefaultController<Uint8Array>
  fail: (message: string) => void
}

export interface BridgeHandle {
  onMessage: (message: unknown) => void
  target: () => Promise<BridgeTargetConfig>
  fetch: typeof globalThis.fetch
  dispose: () => void
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const headerRecord = (headers: HeadersInit | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  if (headers === undefined) return out
  for (const [key, value] of new Headers(headers)) out[key] = value
  return out
}

export function createBridge(options: {
  api: BridgeWebviewApi
  subscribe: (listener: (message: unknown) => void) => () => void
  nextID?: () => string
}): BridgeHandle {
  const nextID = options.nextID ?? (() => `gui_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`)
  const requests = new Map<string, PendingRequest>()
  const streams = new Map<string, PendingStream>()
  let configValue: BridgeTargetConfig | undefined
  let resolveConfig: (config: BridgeTargetConfig) => void = () => {}
  const configPromise = new Promise<BridgeTargetConfig>((resolve) => {
    resolveConfig = resolve
  })
  let readySent = false

  const sendReady = () => {
    if (readySent) return
    readySent = true
    options.api.postMessage({ kind: "ready" } satisfies BridgeOutbound)
  }
  sendReady()

  const onMessage = (message: unknown) => {
    const frame = message as BridgeInbound | undefined
    if (typeof frame !== "object" || frame === null || typeof (frame as { kind?: unknown }).kind !== "string") return
    switch (frame.kind) {
      case "config": {
        if (configValue === undefined) {
          configValue = { baseUrl: frame.baseUrl, directory: frame.directory, serverLabel: frame.serverLabel }
          resolveConfig(configValue)
        }
        return
      }
      case "res": {
        const pending = requests.get(frame.id)
        if (pending === undefined) return
        requests.delete(frame.id)
        pending.resolve(frame)
        return
      }
      case "open-head": {
        streams.get(frame.id)?.head(frame)
        return
      }
      case "chunk": {
        streams.get(frame.id)?.controller.enqueue(decodeBase64(frame.dataBase64))
        return
      }
      case "end": {
        const stream = streams.get(frame.id)
        if (stream === undefined) return
        streams.delete(frame.id)
        if (frame.error !== undefined) stream.controller.error(new Error(frame.error))
        else stream.controller.close()
        return
      }
    }
  }

  const unsubscribe = options.subscribe(onMessage)

  const target = async (): Promise<BridgeTargetConfig> => {
    if (configValue !== undefined) return configValue
    sendReady()
    return configPromise
  }

  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url
    const url = new URL(rawUrl)
    const path = `${url.pathname}${url.search}`
    const method = (init?.method ?? "GET").toUpperCase()
    const headers = headerRecord(init?.headers)
    const id = nextID()
    const signal = init?.signal ?? null

    const postCancel = () => options.api.postMessage({ kind: "cancel", id } satisfies BridgeOutbound)
    const wireAbort = (onAbort: () => void) => {
      if (signal === null) return
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
    }

    if (SSE_ROUTE_PATTERN.test(path)) {
      let settleHead: (frame: BridgeInbound & { kind: "open-head" }) => void = () => {}
      let rejectHead: (error: Error) => void = () => {}
      const headPromise = new Promise<BridgeInbound & { kind: "open-head" }>((resolve, reject) => {
        settleHead = resolve
        rejectHead = reject
      })
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.set(id, {
            head: settleHead,
            controller,
            fail: (message) => controller.error(new Error(message)),
          })
        },
        cancel() {
          streams.delete(id)
          postCancel()
        },
      })
      options.api.postMessage({ kind: "open", id, path } satisfies BridgeOutbound)
      wireAbort(() => {
        const stream = streams.get(id)
        if (stream !== undefined) {
          streams.delete(id)
          stream.fail("Aborted")
        }
        postCancel()
        rejectHead(new DOMException("Aborted", "AbortError"))
      })
      const head = await headPromise
      return new Response(body as BodyInit, { status: head.status, headers: new Headers(head.headers) })
    }

    const responsePromise = new Promise<BridgeInbound & { kind: "res" }>((resolve, reject) => {
      requests.set(id, {
        resolve,
        reject: (error) => {
          requests.delete(id)
          reject(error)
        },
      })
      options.api.postMessage({
        kind: "req",
        id,
        method,
        path,
        headers,
        body: typeof init?.body === "string" ? init.body : undefined,
      } satisfies BridgeOutbound)
    })
    wireAbort(() => {
      const pending = requests.get(id)
      if (pending !== undefined) pending.reject(new DOMException("Aborted", "AbortError"))
      postCancel()
    })
    const frame = await responsePromise
    const body =
      frame.bodyBase64 !== undefined ? decodeBase64(frame.bodyBase64) : frame.text !== undefined ? frame.text : null
    return new Response(body as BodyInit, { status: frame.status, headers: new Headers(frame.headers) })
  }

  return {
    onMessage,
    target,
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    dispose() {
      unsubscribe()
      for (const [, request] of requests) request.reject(new Error("bridge disposed"))
      requests.clear()
      for (const [, stream] of streams) stream.fail("bridge disposed")
      streams.clear()
    },
  }
}
