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

export type LegacySessionHints = {
  directory?: string
  drafts?: readonly { server: ServerConnection.Key; directory: string }[]
  owners?: readonly ServerConnection.Key[]
}

export function legacySessionServer(
  tabs: readonly { type: "session"; server: ServerConnection.Key; sessionId: string }[],
  sessionID: string,
  active: ServerConnection.Key,
  hints: LegacySessionHints = {},
) {
  const matches = tabs.filter((tab) => tab.sessionId === sessionID)
  if (matches.length === 1) return matches[0].server
  if (matches.some((tab) => tab.server === active)) return active

  const owners = [...new Set(hints.owners ?? [])]
  if (matches.length > 1) {
    const matchServers = new Set(matches.map((tab) => tab.server))
    const owned = owners.filter((owner) => matchServers.has(owner))
    if (owned.length === 1) return owned[0]
    return active
  }

  // No tab yet (freshly created remote session, pruned store, or restored URL).
  // A server whose session store already holds the ID is a factual owner.
  if (owners.length === 1) return owners[0]
  if (owners.length > 1) return owners.includes(active) ? active : owners[0]

  // A draft on exactly one server for the same directory is the strongest remaining
  // signal that a just-created session ID belongs there.
  if (hints.directory) {
    const directory = hints.directory
    const draftServers = [
      ...new Set((hints.drafts ?? []).filter((d) => d.directory === directory).map((d) => d.server)),
    ]
    if (draftServers.length === 1) return draftServers[0]
  }

  return active
}

// Runtime states for a desktop SSH server, structurally matching SshServerRuntime so
// the pure status mapping can be tested without the platform layer.
export type ServerRouteRuntime =
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "reconnecting"; attempt: number }
  | { kind: "failed"; message: string }
  | { kind: "stopped" }

export type ServerRouteStatus = { key: string; params?: Record<string, string | number> }

// Chooses the i18n key for the target-server route fallback. When the platform reports
// a concrete SSH runtime state we surface it (reconnecting attempt count, failure message,
// stopped); otherwise we fall back to the generic connecting/unreachable wording.
export function serverRouteStatus(
  server: string,
  runtime: ServerRouteRuntime | undefined,
  opts: { invalid?: boolean; timedOut: boolean },
): ServerRouteStatus {
  if (opts.invalid) return { key: "session.server.invalidRoute" }
  if (runtime?.kind === "reconnecting")
    return { key: "session.server.reconnecting", params: { server, attempt: runtime.attempt } }
  if (runtime?.kind === "failed") return { key: "app.server.unreachable", params: { server } }
  if (runtime?.kind === "stopped") return { key: "session.server.stopped", params: { server } }
  if (runtime?.kind === "starting") return { key: "session.server.connecting", params: { server } }
  return opts.timedOut
    ? { key: "app.server.unreachable", params: { server } }
    : { key: "session.server.connecting", params: { server } }
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
