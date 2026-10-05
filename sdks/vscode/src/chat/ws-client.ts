import { Socket } from "net"
import * as http from "http"
import * as https from "https"
import { randomBytes } from "crypto"

/**
 * Minimal RFC6455 WebSocket client over Node core (http upgrade + crypto).
 * The extension host cannot rely on a global WebSocket in every VS Code
 * runtime, and shipping the `ws` package would add the extension's first
 * runtime dependency. This client only needs what the PTY protocol uses:
 * text/binary frames, fragmentation, close, and ping/pong.
 */

export interface RawSocket {
  send(text: string): void
  sendBinary(data: Uint8Array): void
  onMessage(handler: (data: Uint8Array, isBinary: boolean) => void): void
  onClose(handler: (code: number) => void): void
  close(): void
}

export type WebSocketFactory = (url: string) => Promise<RawSocket>

const opcodeContinuation = 0x0
const opcodeText = 0x1
const opcodeBinary = 0x2
const opcodeClose = 0x8
const opcodePing = 0x9
const opcodePong = 0xa

class FrameReader {
  private buffer = Buffer.alloc(0)
  private fragments: { chunks: Buffer[]; opcode: number } | undefined

  constructor(
    private readonly onFrame: (payload: Buffer, opcode: number, fin: boolean) => void,
    private readonly fail: (error: Error) => void,
  ) {}

  feed(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.buffer.length < 2) return
      const first = this.buffer[0]
      const second = this.buffer[1]
      const fin = (first & 0x80) !== 0
      const opcode = this.fragments === undefined ? first & 0x7f : opcodeContinuation
      const masked = (second & 0x80) !== 0
      if (masked) {
        this.fail(new Error("server frame must not be masked"))
        return
      }
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (this.buffer.length < offset + 2) return
        length = this.buffer.readUInt16BE(offset)
        offset += 2
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return
        const big = this.buffer.readUIntBE(offset, 8)
        if (big > 0x7fffffff) {
          this.fail(new Error("frame too large"))
          return
        }
        length = big
        offset += 8
      }
      if (this.buffer.length < offset + length) return
      const payload = this.buffer.subarray(offset, offset + length)
      this.buffer = this.buffer.subarray(offset + length)
      this.handleFrame(opcode, payload, fin)
    }
  }

  private handleFrame(opcode: number, payload: Buffer, fin: boolean) {
    if (opcode === opcodeContinuation) {
      if (this.fragments === undefined) return
      this.fragments.chunks.push(Buffer.from(payload))
      if (!fin) return
      const merged = Buffer.concat(this.fragments.chunks)
      const started = this.fragments.opcode
      this.fragments = undefined
      this.onFrame(merged, started, true)
      return
    }
    if (opcode === opcodeText || opcode === opcodeBinary) {
      if (!fin) {
        this.fragments = { chunks: [Buffer.from(payload)], opcode }
        return
      }
      this.onFrame(Buffer.from(payload), opcode, true)
      return
    }
    void payload
    if (opcode === opcodeClose) this.onFrame(Buffer.alloc(0), opcodeClose, true)
    else if (opcode === opcodePing) this.onFrame(Buffer.alloc(0), opcodePing, true)
    else if (opcode === opcodePong) this.onFrame(Buffer.alloc(0), opcodePong, true)
  }
}

const maskPayload = (payload: Buffer, key: Buffer): Buffer => {
  const out = Buffer.from(payload)
  for (let i = 0; i < out.length; i++) out[i] = out[i] ^ key[i % 4]
  return out
}

const encodeFrame = (opcode: number, payload: Buffer): Buffer => {
  const mask = randomBytes(4)
  const length = payload.length
  let header: number[] = [0x80 | opcode]
  if (length < 126) header = [0x80 | opcode, 0x80 | length]
  else if (length < 65536) {
    header = [0x80 | opcode, 0x80 | 126, (length >> 8) & 0xff, length & 0xff]
  } else {
    header = [0x80 | opcode, 0x80 | 127, 0, 0, 0, 0, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]
  }
  return Buffer.concat([Buffer.from(header), mask, maskPayload(payload, Buffer.from(mask))])
}

export const createWebSocket: WebSocketFactory = (url) =>
  new Promise<RawSocket>((resolve, reject) => {
    let settled = false
    const target = new URL(url)
    const secure = target.protocol === "https:" || target.protocol === "wss:"
    const transport = secure ? https : http
    if (target.protocol === "ws:") target.protocol = "http:"
    if (target.protocol === "wss:") target.protocol = "https:"
    const key = randomBytes(16).toString("base64")
    const request = transport.request(target, {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": key,
        "sec-websocket-version": "13",
      },
    })
    const messageHandlers: ((data: Uint8Array, isBinary: boolean) => void)[] = []
    const closeHandlers: ((code: number) => void)[] = []
    type PendingEvent = { kind: "message"; data: Uint8Array; isBinary: boolean } | { kind: "close"; code: number }
    const pending: PendingEvent[] = []
    let messageReplayed = false
    let closeReplayed = false
    let socket: Socket | undefined
    let closed = false

    const emitMessage = (data: Uint8Array, isBinary: boolean) => {
      if (messageHandlers.length === 0) {
        pending.push({ kind: "message", data, isBinary })
        return
      }
      for (const handler of messageHandlers) handler(data, isBinary)
    }

    const emitClose = (code: number) => {
      if (closed) return
      closed = true
      if (closeHandlers.length === 0) {
        pending.push({ kind: "close", code })
        return
      }
      for (const handler of closeHandlers) handler(code)
    }

    const reader = new FrameReader(
      (payload, opcode) => {
        if (opcode === opcodeClose) {
          emitClose(1000)
          socket?.destroy()
          return
        }
        if (opcode === opcodePing) {
          if (socket?.writable) socket.write(encodeFrame(opcodePong, Buffer.alloc(0)))
          return
        }
        if (opcode === opcodePong) return
        const isBinary = opcode !== opcodeText
        emitMessage(new Uint8Array(payload), isBinary)
      },
      (error) => {
        if (!settled) reject(error)
        else emitClose(1006)
        socket?.destroy()
      },
    )

    request.on("upgrade", (response, upgraded, head) => {
      if (response.statusCode !== 101) {
        request.destroy()
        reject(new Error(`websocket upgrade failed: HTTP ${response.statusCode}`))
        return
      }
      settled = true
      socket = upgraded
      upgraded.on("data", (chunk: Buffer) => reader.feed(chunk))
      upgraded.on("close", () => emitClose(1006))
      upgraded.on("error", () => emitClose(1006))
      if (head.length > 0) reader.feed(head)
      resolve({
        send(text) {
          if (socket !== undefined && socket.writable) socket.write(encodeFrame(opcodeText, Buffer.from(text, "utf8")))
        },
        sendBinary(data) {
          if (socket !== undefined && socket.writable) socket.write(encodeFrame(opcodeBinary, Buffer.from(data)))
        },
        onMessage(handler) {
          messageHandlers.push(handler)
          if (messageReplayed) return
          messageReplayed = true
          for (const event of pending) if (event.kind === "message") handler(event.data, event.isBinary)
        },
        onClose(handler) {
          closeHandlers.push(handler)
          if (closeReplayed) return
          closeReplayed = true
          for (const event of pending) if (event.kind === "close") handler(event.code)
        },
        close() {
          if (socket !== undefined && socket.writable) socket.write(encodeFrame(opcodeClose, Buffer.alloc(0)))
          socket?.end()
          emitClose(1000)
        },
      })
    })
    request.on("response", (response) => {
      response.resume()
      if (!settled) reject(new Error(`expected 101 upgrade, got HTTP ${response.statusCode}`))
    })
    request.on("error", (error) => {
      if (!settled) reject(error)
      else emitClose(1006)
    })
    request.end()
  })
