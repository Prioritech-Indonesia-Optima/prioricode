export * as LSPJSONRPC from "./jsonrpc"

import type { ChildProcessByStdio } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import { FSUtil } from "../fs-util"

export type RequestID = number

export interface Request {
  readonly jsonrpc: "2.0"
  readonly id: RequestID
  readonly method: string
  readonly params?: unknown
}

export interface Notification {
  readonly jsonrpc: "2.0"
  readonly method: string
  readonly params?: unknown
}

export interface Response {
  readonly jsonrpc: "2.0"
  readonly id: RequestID
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

export type Message = Request | Notification | Response

export const encode = (message: Message): Buffer => {
  const body = JSON.stringify(message)
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`, "utf8")
}

export const isMessage = (value: unknown): value is Message => {
  if (typeof value !== "object" || value === null) return false
  const message = value as Partial<Message> & Record<string, unknown>
  return message.jsonrpc === "2.0" && ("method" in message || "id" in message)
}

export const normalizePath = FSUtil.normalizePath

export const pathExtname = (file: string) => {
  const base = file.slice(Math.max(0, file.lastIndexOf("/") + 1, file.lastIndexOf("\\") + 1)).toLowerCase()
  if (base === "makefile" || base === "dockerfile") return base
  const index = base.lastIndexOf(".")
  return index <= 0 ? base : base.slice(index)
}

/** Incremental parser for `Content-Length`-framed JSON-RPC messages over arbitrary byte chunks. */
export class Parser {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): Message[] {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk])
    const messages: Message[] = []
    for (;;) {
      const boundary = this.buffer.indexOf("\r\n\r\n")
      if (boundary === -1) return messages
      const header = this.buffer.subarray(0, boundary).toString("utf8")
      const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1] ?? Number.NaN)
      if (!Number.isFinite(length) || length < 0) {
        this.buffer = this.buffer.subarray(boundary + 4)
        continue
      }
      const start = boundary + 4
      if (this.buffer.length < start + length) return messages
      const body = this.buffer.subarray(start, start + length).toString("utf8")
      this.buffer = this.buffer.subarray(start + length)
      try {
        const message = JSON.parse(body)
        if (isMessage(message)) messages.push(message)
      } catch {}
    }
  }
}

export type NotificationHandler = (params: unknown) => void
export type RequestHandler = (params: unknown) => unknown | Promise<unknown>

export class DisconnectedError extends Error {
  readonly _tag = "LSP.DisconnectedError"
  constructor() {
    super("LSP connection closed")
  }
}

/**
 * One JSON-RPC 2.0 connection over a language server's stdio. Handlers must be
 * registered before `listen`. Server-initiated requests receive `null` unless a
 * handler is registered for their method.
 */
export class MessageConnection {
  private nextID = 1
  private readonly parser = new Parser()
  private readonly pending = new Map<RequestID, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly notifications = new Map<string, NotificationHandler[]>()
  private readonly requests = new Map<string, RequestHandler>()
  private listening = false

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {}

  onNotification(method: string, handler: NotificationHandler) {
    this.notifications.set(method, [...(this.notifications.get(method) ?? []), handler])
  }

  onRequest(method: string, handler: RequestHandler) {
    this.requests.set(method, handler)
  }

  notify(method: string, params?: unknown) {
    this.send({ jsonrpc: "2.0", method, params } as Notification)
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextID++
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.send({ jsonrpc: "2.0", id, method, params } as Request)
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new DisconnectedError())
      }
    })
  }

  listen() {
    if (this.listening) return
    this.listening = true
    this.input.on("data", (chunk: Buffer) => this.handle(chunk))
    const fail = () => this.close()
    this.input.on("error", fail)
    this.input.on("end", fail)
    this.input.on("close", fail)
  }

  close() {
    for (const [, entry] of this.pending) entry.reject(new DisconnectedError())
    this.pending.clear()
  }

  private send(message: Message) {
    if (this.output.destroyed || !this.output.write(encode(message))) throw new DisconnectedError()
  }

  private handle(chunk: Buffer) {
    for (const message of this.parser.push(chunk)) {
      if ("method" in message && "id" in message) {
        const handler = this.requests.get(message.method)
        Promise.resolve()
          .then(() => (handler ? handler(message.params) : null))
          .then((result) => {
            this.send({ jsonrpc: "2.0", id: message.id, result: result ?? null } as Response)
          })
          .catch(() => {})
        continue
      }
      if ("method" in message) {
        for (const handler of this.notifications.get(message.method) ?? []) handler(message.params)
        continue
      }
      const entry = this.pending.get(message.id)
      if (!entry) continue
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${message.error.code}: ${message.error.message}`))
      else entry.resolve(message.result ?? null)
    }
  }
}

export interface Handle {
  readonly connection: MessageConnection
  readonly pid: number | undefined
  readonly dispose: () => void
}
