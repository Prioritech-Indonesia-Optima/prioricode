import { ptyConnectToken, ptyConnectURL, type RawTransport } from "./extensions"
import type { AppTransport } from "../../app/transport"

/**
 * PTY socket abstraction with one implementation per host.
 *
 * Browser: fetch a single-use connect-ticket, then a direct WebSocket with
 * only the ticket in the query (never the password). VS Code: the extension
 * host mints the ticket and relays WS frames over the bridge, because the
 * server origin check rejects `vscode-webview://` connections.
 *
 * Wire protocol (packages/core/src/pty/protocol.ts): raw UTF-8 output frames;
 * a control frame starting with byte 0x00 carries JSON {cursor} for replay.
 */

export interface PtyConnection {
  write: (text: string) => void
  resize: (rows: number, cols: number) => void
  close: () => void
  closed: Promise<{ cursor: number; code?: number }>
}

const unwrapList = (value: unknown): { id: string; status?: string }[] => {
  const rows = (value as { data?: unknown })?.data ?? value
  return Array.isArray(rows) ? (rows as { id: string; status?: string }[]) : []
}

const unwrapCreate = (value: unknown): { id?: string } => {
  const info = (value as { data?: unknown })?.data ?? value
  return (info as { id?: string }) ?? {}
}

export async function openPty(options: {
  transport: AppTransport
  ptyID: string
  cursor?: number
  onData: (data: Uint8Array) => void
}): Promise<PtyConnection | undefined> {
  const { transport, ptyID } = options
  let cursor = options.cursor ?? 0
  const dispatch = (bytes: Uint8Array) => {
    if (bytes.length > 0 && bytes[0] === 0x00) {
      try {
        const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as { cursor?: unknown }
        if (typeof meta.cursor === "number") cursor = meta.cursor
      } catch {
        // malformed control frame is ignorable; replay continues from last known cursor
      }
      return
    }
    options.onData(bytes)
  }
  const location = transport.directory === undefined ? undefined : { directory: transport.directory }

  if (transport.kind === "vscode" && transport.bridge !== undefined) {
    const channel = await transport.bridge.requestPty({ ptyID, cursor: options.cursor, onData: dispatch })
    if (channel === undefined) return undefined
    const encoder = new TextEncoder()
    return {
      write: (text) => channel.send(encoder.encode(text)),
      resize: (rows, cols) => {
        void transport.client?.ptys.update({ ptyID, size: { rows, cols } }).catch(() => {})
      },
      close: channel.close,
      closed: channel.closed.then((code) => ({ cursor, ...(code === undefined ? {} : { code }) })),
    }
  }

  if (transport.baseUrl.length === 0) return undefined
  const raw: RawTransport = {
    baseUrl: transport.baseUrl,
    fetch: globalThis.fetch,
    headers: () => transport.authHeaders?.() ?? {},
  }
  const ticket = await ptyConnectToken(raw, ptyID, location)
  const url = ptyConnectURL(transport.baseUrl, ptyID, { ticket: ticket.ticket, cursor: options.cursor, location })
  const socket = new WebSocket(url)
  socket.binaryType = "arraybuffer"
  const closed = new Promise<{ cursor: number; code?: number }>((resolve) => {
    socket.onclose = (event) => resolve({ cursor, code: event.code })
  })
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error("pty websocket failed"))
  }).catch(() => undefined)
  if (socket.readyState !== WebSocket.OPEN) return undefined
  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) dispatch(new Uint8Array(event.data))
    else if (typeof event.data === "string") dispatch(new TextEncoder().encode(event.data))
  }
  return {
    write: (text) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(text)
    },
    resize: (rows, cols) => {
      void transport.client?.ptys
        .update({ ptyID, size: { rows, cols }, ...(location === undefined ? {} : { location }) })
        .catch(() => {})
    },
    close: () => socket.close(1000),
    closed,
  }
}

export async function ensureTerminalPty(transport: AppTransport): Promise<string | undefined> {
  const client = transport.client
  if (client === undefined) return undefined
  const location = transport.directory === undefined ? undefined : { directory: transport.directory }
  try {
    const listed = unwrapList(await client.ptys.list(location === undefined ? undefined : { location }))
    const running = listed.find((pty) => pty.status === "running")
    if (running !== undefined) return running.id
    const created = unwrapCreate(
      await client.ptys.create({ ...(location === undefined ? {} : { location }), title: "PrioriCode GUI" }),
    )
    return created.id
  } catch {
    return undefined
  }
}
