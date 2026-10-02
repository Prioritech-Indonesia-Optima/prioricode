// Remote clipboard bridge client. Terminal clipboard protocols (kitty OSC 5522,
// OSC 52) only answer in a minority of emulators, and no escape sequence carries
// an image across plain SSH at all. `prioricode paste-serve` runs on the machine
// the user actually copied on and serves the live clipboard on loopback; a one-time
// ssh `RemoteForward` makes that loopback port reachable inside remote sessions, so
// Ctrl+V works in every terminal, text and images included. When no forward is
// configured the request fails fast and callers fall through to the existing
// terminal-protocol and host paths.
import type { Content } from "./clipboard"

export const PASTE_BRIDGE_DEFAULT_PORT = 48917

export function bridgePort(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env.PRIORICODE_PASTE_PORT
  if (raw === undefined) return PASTE_BRIDGE_DEFAULT_PORT
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : PASTE_BRIDGE_DEFAULT_PORT
}

export type BridgePayload = Readonly<{
  text?: string
  image?: Readonly<{ base64: string; mime: string }>
}>

export function parseBridgePayload(value: unknown): Content | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const payload = value as BridgePayload
  if (payload.image?.base64 && payload.image.mime) return { data: payload.image.base64, mime: payload.image.mime }
  if (typeof payload.text === "string" && payload.text.length > 0) return { data: payload.text, mime: "text/plain" }
  return undefined
}

export async function fetchBridgeClipboard(
  port: number = bridgePort(),
  timeoutMs = 400,
  http: (url: string, options: { signal: AbortSignal }) => Promise<Response> = (url, options) => fetch(url, options),
): Promise<Content | undefined> {
  // Deliberately broad: the bridge is an opportunistic probe. Any connect
  // failure, timeout, or malformed payload means "no bridge here" and the
  // caller continues with the terminal protocol and host clipboard.
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await http(`http://127.0.0.1:${port}/clipboard`, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) return undefined
    return parseBridgePayload(await response.json())
  } catch {
    return undefined
  }
}
