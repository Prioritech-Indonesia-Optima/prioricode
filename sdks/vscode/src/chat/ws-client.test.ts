import { describe, expect, it } from "bun:test"
import http from "http"
import crypto from "crypto"
import type { AddressInfo } from "net"
import { createWebSocket } from "./ws-client"

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

const serverFrame = (opcode: number, payload: Buffer, fin = true): Buffer => {
  let header: number[] = [(fin ? 0x80 : 0) | opcode]
  if (payload.length < 126) header.push(payload.length)
  else if (payload.length < 65536) header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff)
  return Buffer.concat([Buffer.from(header), payload])
}

const parseClientFrame = (raw: Buffer): { opcode: number; payload: Buffer } => {
  const opcode = raw[0] & 0x7f
  const masked = (raw[1] & 0x80) !== 0
  let length = raw[1] & 0x7f
  let offset = 2
  if (length === 126) {
    length = raw.readUInt16BE(offset)
    offset += 2
  }
  if (!masked) throw new Error("client frames must be masked")
  const key = raw.subarray(offset, offset + 4)
  offset += 4
  const payload = Buffer.from(raw.subarray(offset, offset + length))
  for (let i = 0; i < payload.length; i++) payload[i] = payload[i] ^ key[i % 4]
  return { opcode, payload }
}

function upgradeServer(
  onSocket: (socket: import("net").Socket, head: Buffer) => void,
): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer()
    server.on("upgrade", (req, socket, head) => {
      const key = req.headers["sec-websocket-key"] ?? ""
      const accept = crypto
        .createHash("sha1")
        .update(key + GUID)
        .digest("base64")
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      )
      onSocket(socket as import("net").Socket, head)
    })
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        url: `ws://127.0.0.1:${port}/pty/p_1/connect?ticket=t`,
        close: () => server.close(),
      })
    })
  })
}

describe("extension-host websocket client", () => {
  it("completes the handshake, exchanges masked client frames and server binary frames", async () => {
    const server = await upgradeServer((socket) => {
      socket.on("data", (chunk) => {
        const frame = parseClientFrame(chunk)
        if (frame.opcode === 0x1) socket.write(serverFrame(0x2, Buffer.from(`echo:${frame.payload.toString("utf8")}`)))
      })
    })
    try {
      const ws = await createWebSocket(server.url)
      const received: string[] = []
      ws.onMessage((data, isBinary) =>
        received.push(`${isBinary ? "bin" : "txt"}:${Buffer.from(data).toString("utf8")}`),
      )
      ws.send("hi")
      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(received).toEqual(["bin:echo:hi"])
      ws.close()
    } finally {
      server.close()
    }
  })

  it("reassembles fragmented server frames", async () => {
    const server = await upgradeServer((socket) => {
      socket.write(serverFrame(0x1, Buffer.from("part1"), false))
      socket.write(serverFrame(0x0, Buffer.from("part2"), true))
    })
    try {
      const ws = await createWebSocket(server.url)
      const received: string[] = []
      ws.onMessage((data) => received.push(Buffer.from(data).toString("utf8")))
      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(received).toEqual(["part1part2"])
      ws.close()
    } finally {
      server.close()
    }
  })

  it("emits close when the server sends a close frame", async () => {
    const server = await upgradeServer((socket) => {
      setTimeout(() => socket.write(serverFrame(0x8, Buffer.alloc(0))), 10)
    })
    try {
      const ws = await createWebSocket(server.url)
      const codes: number[] = []
      ws.onClose((code) => codes.push(code))
      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(codes).toEqual([1000])
    } finally {
      server.close()
    }
  })

  it("rejects when the upgrade is refused", async () => {
    const plain = http.createServer((_req, res) => res.writeHead(404).end())
    await new Promise<void>((resolve) => plain.listen(0, "127.0.0.1", resolve))
    try {
      await expect(createWebSocket(`ws://127.0.0.1:${(plain.address() as AddressInfo).port}/x`)).rejects.toThrow()
    } finally {
      plain.close()
    }
  })
})
