import { describe, expect, it } from "bun:test"
import { openPty } from "./pty"
import type { AppTransport } from "../../app/transport"
import type { BridgeHandle, PtyChannel } from "./bridge"

function fakeTransport(bridge: BridgeHandle): AppTransport {
  return {
    kind: "vscode",
    baseUrl: "http://daemon",
    status: "ready",
    openStream: async () => new Response(null),
    openExternal: () => {},
    retry: () => {},
    bridge,
  }
}

describe("openPty bridge path", () => {
  it("parses cursor meta frames and forwards output", async () => {
    const writes: number[] = []
    let pushData: ((bytes: Uint8Array) => void) | undefined
    const transport = fakeTransport({
      requestPty: async (request: { onData: (bytes: Uint8Array) => void }) => {
        pushData = request.onData
        return { send: () => {}, close: () => {}, closed: Promise.resolve(1001) } satisfies PtyChannel
      },
    } as unknown as BridgeHandle)
    const conn = await openPty({ transport, ptyID: "p_9", onData: (bytes) => writes.push(...bytes) })
    expect(conn).toBeDefined()
    pushData?.(new TextEncoder().encode("$ "))
    const meta = new Uint8Array(1 + new TextEncoder().encode('{"cursor":77}').length)
    meta[0] = 0
    meta.set(new TextEncoder().encode('{"cursor":77}'), 1)
    pushData?.(meta)
    expect(writes).toEqual(Array.from(new TextEncoder().encode("$ ")))
  })

  it("resolves cursor and code from the underlying channel", async () => {
    let pushData: ((bytes: Uint8Array) => void) | undefined
    let resolveClosed: (code: number | undefined) => void = () => {}
    const channel: PtyChannel = {
      send: () => {},
      close: () => resolveClosed(1000),
      closed: new Promise((resolve) => {
        resolveClosed = resolve
      }),
    }
    const transport = fakeTransport({
      requestPty: async (request: { onData: (bytes: Uint8Array) => void }) => {
        pushData = request.onData
        return channel
      },
    } as unknown as BridgeHandle)
    const conn = await openPty({ transport, ptyID: "p_9", cursor: 4, onData: () => {} })
    expect(conn).toBeDefined()
    const meta = new Uint8Array(1 + new TextEncoder().encode('{"cursor":99}').length)
    meta[0] = 0
    meta.set(new TextEncoder().encode('{"cursor":99}'), 1)
    pushData?.(meta)
    const closedPromise = conn!.closed
    channel.close()
    expect(await closedPromise).toEqual({ cursor: 99, code: 1000 })
  })

  it("returns undefined when the host relay refuses", async () => {
    const transport = fakeTransport({ requestPty: async () => undefined } as unknown as BridgeHandle)
    expect(await openPty({ transport, ptyID: "p_1", onData: () => {} })).toBeUndefined()
  })
})
