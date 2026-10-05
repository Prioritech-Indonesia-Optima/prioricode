import { createBridge, type BridgeHandle, type BridgeSelection } from "../core/transport/bridge"
import { createGuiClient, type GuiClient } from "../core/transport/client"
import { basicAuthorization, readStoredTarget, writeStoredTarget, type DirectTarget } from "../core/transport/direct"
import { detectHost, type GuiHost } from "../lib/host"
import type { StoreStatus } from "./store"
export interface AppTransport {
  kind: GuiHost
  baseUrl: string
  client?: GuiClient
  status: StoreStatus
  statusDetail?: string
  directory?: string
  serverLabel?: string
  defaultModel?: { id: string; providerID: string }
  openStream: (route: string, signal: AbortSignal) => Promise<Response>
  openExternal: (url: string) => void
  requestSelection?: () => Promise<BridgeSelection | undefined>
  openFile?: (path: string) => void
  authHeaders?: () => Record<string, string>
  retry: () => void
  bridge?: BridgeHandle
}

const webBase = (target: DirectTarget): string => target.baseUrl || globalThis.location?.origin || "http://127.0.0.1:4096"

const assertStream = async (open: Promise<Response>): Promise<Response> => {
  const response = await open
  if (!response.ok || response.body === null) {
    try {
      await response.text()
    } catch {}
    throw new Error(`stream http ${response.status}`)
  }
  return response
}

const webAuthHeaders = (target: DirectTarget): Record<string, string> => {
  const headers: Record<string, string> = {}
  if (target.password !== undefined) {
    headers.authorization = basicAuthorization(target.username ?? "prioricode", target.password)
  }
  return headers
}

function webTransport(target: DirectTarget): AppTransport {
  const baseUrl = webBase(target)
  const headers = webAuthHeaders(target)
  const client = createGuiClient({ baseUrl, headers })
  return {
    kind: "web",
    baseUrl,
    client,
    status: "ready",
    directory: target.directory,
    openStream: (route, signal) =>
      assertStream(fetch(`${baseUrl}${route}`, { headers: { ...headers, accept: "text/event-stream" }, signal })),
    openExternal: (url) => {
      globalThis.open(url, "_blank", "noopener")
    },
    authHeaders: () => headers,
    retry: () => {},
  }
}

function acquireApi(): { postMessage: (message: unknown) => void } | undefined {
  const win = globalThis as unknown as { acquireVsCodeApi?: () => { postMessage: (message: unknown) => void } }
  if (typeof win.acquireVsCodeApi !== "function") return undefined
  return win.acquireVsCodeApi()
}

async function vscodeTransport(): Promise<AppTransport> {
  const api = acquireApi()
  if (api === undefined) throw new Error("acquireVsCodeApi unavailable")
  const bridge = createBridge({
    api,
    subscribe: (listener) => {
      const handler = (event: MessageEvent) => listener(event.data)
      globalThis.addEventListener("message", handler)
      return () => globalThis.removeEventListener("message", handler)
    },
  })
  const config = await new Promise<Awaited<ReturnType<typeof bridge.target>> | undefined>((resolve) => {
    let settled = false
    const off = bridge.onConfig((next) => {
      if (!settled) {
        settled = true
        off()
        resolve(next)
      }
    })
    bridge.target().then((ready) => {
      if (!settled) {
        settled = true
        off()
        resolve(ready)
      }
    })
    setTimeout(() => {
      if (!settled) {
        settled = true
        off()
        resolve(undefined)
      }
    }, 15_000)
  })
  const fallback: AppTransport = {
    kind: "vscode",
    baseUrl: "",
    status: config?.status === "ready" ? "ready" : (config?.status ?? "connecting"),
    statusDetail: config?.detail,
    directory: config?.directory,
    openStream: (route, signal) => assertStream(bridge.fetch(`http://prioricode.invalid${route}`, { signal })),
    openExternal: (url) => api.postMessage({ kind: "openExternal", url }),
    requestSelection: () => bridge.requestSelection(),
    openFile: (path) => api.postMessage({ kind: "openFile", path }),
    retry: () => bridge.retry(),
    bridge,
  }
  if (config === undefined || config.status !== "ready") return fallback
  const client = createGuiClient({ baseUrl: config.baseUrl, fetch: bridge.fetch })
  return {
    kind: "vscode",
    baseUrl: config.baseUrl,
    client,
    status: "ready",
    statusDetail: undefined,
    directory: config.directory,
    serverLabel: config.serverLabel,
    openStream: (route, signal) =>
      assertStream(bridge.fetch(`${config.baseUrl}${route}`, { headers: { accept: "text/event-stream" }, signal })),
    openExternal: (url) => api.postMessage({ kind: "openExternal", url }),
    requestSelection: () => bridge.requestSelection(),
    openFile: (path) => api.postMessage({ kind: "openFile", path }),
    retry: () => bridge.retry(),
    bridge,
  }
}

export async function bootTransport(): Promise<AppTransport> {
  const host = detectHost()
  if (host === "vscode") return vscodeTransport()
  return webTransport(readStoredTarget() ?? { baseUrl: "" })
}

export { writeStoredTarget, readStoredTarget }
export type { DirectTarget }
