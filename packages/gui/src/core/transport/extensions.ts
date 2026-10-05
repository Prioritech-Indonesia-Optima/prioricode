/**
 * Hand-written calls for endpoints the generated client cannot express yet.
 * Every entry cites its protocol source. Remove entries when codegen covers them:
 *   - fs.read:          packages/protocol/src/groups/fs.ts:21-24   (wildcard segment defeats codegen)
 *   - pty.connectToken: packages/protocol/src/groups/pty.ts:101-115 (omitted, packages/client/src/contract.ts:53)
 *   - pty.connect WS:   packages/protocol/src/groups/pty.ts:117-140 (WebSocket upgrade, not HTTP)
 *   - session todo:     V1-only packages/prioricode/src/server/routes/instance/httpapi/groups/session.ts:116,190
 *   - session diff:     V1-only packages/prioricode/src/server/routes/instance/httpapi/groups/session.ts:118
 * V1 routes use the workspace-routing query dialect `?directory=&workspace=` while V2 uses
 * `?location[directory]=`; keep both dialects inside this module only.
 */

export interface RawTransport {
  baseUrl: string
  fetch: typeof globalThis.fetch
  headers?: () => Record<string, string>
}

export interface LocationRef {
  directory?: string
  workspace?: string
}

export const PTY_CONNECT_TICKET_QUERY = "ticket"
export const PTY_CONNECT_TOKEN_HEADER = "x-prioricode-ticket"

const buildUrl = (
  transport: RawTransport,
  path: string,
  query?: Iterable<readonly [string, string | number | undefined]>,
) => {
  const url = new URL(path, transport.baseUrl)
  if (query !== undefined) {
    for (const [key, value] of query) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  return url
}

const requestInit = (transport: RawTransport, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(transport.headers?.() ?? {}), ...(init.headers as Record<string, string> | undefined) },
})

const unwrap = (value: unknown): unknown => {
  if (typeof value === "object" && value !== null && "data" in value) return (value as { data: unknown }).data
  return value
}

/** GET /api/fs/read/* — binary-safe file read relative to the location. */
export async function fsRead(transport: RawTransport, path: string, location?: LocationRef): Promise<Uint8Array> {
  const encoded = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  const url = buildUrl(
    transport,
    `/api/fs/read/${encoded}`,
    location?.directory !== undefined ? [["location[directory]", location.directory]] : undefined,
  )
  const response = await (0, transport.fetch)(url.toString(), requestInit(transport))
  if (!response.ok) throw new Error(`fs.read failed: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

export interface PtyTicket {
  ticket: string
  expiresIn: number
}

/** POST /api/pty/:ptyID/connect-token — short-lived single-use WebSocket ticket. */
export async function ptyConnectToken(
  transport: RawTransport,
  ptyID: string,
  location?: LocationRef,
): Promise<PtyTicket> {
  const url = buildUrl(transport, `/api/pty/${encodeURIComponent(ptyID)}/connect-token`, [
    ...(location?.directory !== undefined ? ([["location[directory]", location.directory]] as const) : []),
    ...(location?.workspace !== undefined ? ([["location[workspace]", location.workspace]] as const) : []),
  ])
  const response = await (0, transport.fetch)(
    url.toString(),
    requestInit(transport, { method: "POST", headers: { [PTY_CONNECT_TOKEN_HEADER]: "1" } }),
  )
  if (!response.ok) throw new Error(`connect-token failed: HTTP ${response.status}`)
  const payload = unwrap(await response.json()) as { ticket?: unknown; expires_in?: unknown }
  if (typeof payload?.ticket !== "string" || typeof payload?.expires_in !== "number") {
    throw new Error("connect-token malformed")
  }
  return { ticket: payload.ticket, expiresIn: payload.expires_in }
}

/** WS GET /api/pty/:ptyID/connect?ticket=&cursor= — ticket replaces credentials. */
export function ptyConnectURL(
  baseUrl: string,
  ptyID: string,
  options: { ticket: string; cursor?: number; location?: LocationRef },
): string {
  const url = buildUrl({ baseUrl, fetch: globalThis.fetch }, `/api/pty/${encodeURIComponent(ptyID)}/connect`, [
    [PTY_CONNECT_TICKET_QUERY, options.ticket],
    ["cursor", options.cursor],
    ...(options.location?.directory !== undefined
      ? ([["location[directory]", options.location.directory]] as const)
      : []),
    ...(options.location?.workspace !== undefined
      ? ([["location[workspace]", options.location.workspace]] as const)
      : []),
  ])
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

export interface SessionTodoItem {
  content: string
  status: string
  priority?: string
}

/** V1 GET /session/:sessionID/todo — no V2 equivalent yet; undefined when unavailable. */
export async function sessionTodo(
  transport: RawTransport,
  sessionID: string,
  location?: LocationRef,
): Promise<SessionTodoItem[] | undefined> {
  try {
    const url = buildUrl(transport, `/session/${encodeURIComponent(sessionID)}/todo`, [
      ["directory", location?.directory],
      ["workspace", location?.workspace],
    ])
    const response = await (0, transport.fetch)(url.toString(), requestInit(transport))
    if (!response.ok) return undefined
    const payload = unwrap(await response.json())
    if (!Array.isArray(payload)) return undefined
    return payload.filter(
      (item): item is SessionTodoItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as SessionTodoItem).content === "string" &&
        typeof (item as SessionTodoItem).status === "string",
    )
  } catch {
    return undefined
  }
}

/** V1 GET /session/:sessionID/diff — files changed by the session; undefined when unavailable. */
export async function sessionDiff(
  transport: RawTransport,
  sessionID: string,
  options?: { messageID?: string; location?: LocationRef },
): Promise<unknown[] | undefined> {
  try {
    const url = buildUrl(transport, `/session/${encodeURIComponent(sessionID)}/diff`, [
      ["messageID", options?.messageID],
      ["directory", options?.location?.directory],
      ["workspace", options?.location?.workspace],
    ])
    const response = await (0, transport.fetch)(url.toString(), requestInit(transport))
    if (!response.ok) return undefined
    const payload = unwrap(await response.json())
    return Array.isArray(payload) ? payload : undefined
  } catch {
    return undefined
  }
}
