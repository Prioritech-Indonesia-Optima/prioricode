import { base64Encode } from "@prioricode/core/util/encode"
import { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function sessionHref(server: ServerConnection.Key, sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

export function legacySessionHref(directory: string, sessionID: string) {
  return `/${base64Encode(directory)}/session/${sessionID}`
}

export function requireServerKey(segment: string | undefined) {
  const key = serverKeyFromSegment(segment)
  if (!key) throw new Error("Invalid server route")
  return key
}

export function serverKeyFromSegment(segment: string | undefined): ServerConnection.Key | undefined {
  const key = decode64(segment)
  if (!key || base64Encode(key) !== segment) return
  return ServerConnection.Key.make(key)
}

export function serverKeyLabel(key: ServerConnection.Key) {
  const value = key as string
  if (value === "sidecar") return "Local"
  if (value.startsWith("wsl:")) return value.slice(4)
  if (value.startsWith("ssh:")) return value.slice(4)
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

export function legacySessionServer(
  tabs: readonly { type: "session"; server: ServerConnection.Key; sessionId: string }[],
  sessionID: string,
  active: ServerConnection.Key,
) {
  const matches = tabs.filter((tab) => tab.sessionId === sessionID)
  return matches.find((tab) => tab.server === active)?.server ?? (matches.length === 1 ? matches[0]?.server : active)
}

type SessionParent = { id: string; parentID?: string }

export async function rootSession<T extends SessionParent>(session: T, get: (sessionID: string) => Promise<T>) {
  const seen = new Set([session.id])
  let current = session
  while (current.parentID) {
    if (seen.has(current.parentID)) throw new Error(`Session parent cycle: ${current.parentID}`)
    seen.add(current.parentID)
    current = await get(current.parentID)
  }
  return current
}
