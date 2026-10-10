import { expect, test } from "bun:test"
import { createAttachmentBroker, fakeTransport } from "../src/attachments/broker"
import type { AttachmentTransport } from "../src/attachments/types"

const clipboard = { id: "clipboard", label: "Terminal clipboard", kind: "clipboard" as const }
const drop = { id: "drop", label: "File drop", kind: "drop" as const }
const companion = { id: "companion", label: "VS Code companion", kind: "companion" as const }

const png = new Uint8Array([1, 2, 3])

test("cascade stops at first attached transport", async () => {
  const broker = createAttachmentBroker({
    transports: () => [
      fakeTransport(clipboard, { status: "empty", source: clipboard }),
      fakeTransport(drop, {
        status: "attached",
        source: drop,
        payload: { filename: "shot.png", mime: "image/png", bytes: png },
      }),
      fakeTransport(companion, {
        status: "attached",
        source: companion,
        payload: { filename: "other.png", mime: "image/png", bytes: png },
      }),
    ],
  })
  const outcome = await broker.request()
  expect(outcome.status).toBe("attached")
  expect(outcome.payload?.filename).toBe("shot.png")
  expect(outcome.attempts.length).toBe(2)
})

test("preferred transport goes first", async () => {
  const broker = createAttachmentBroker({
    transports: () => [
      fakeTransport(clipboard, {
        status: "attached",
        source: clipboard,
        payload: { filename: "clip.png", mime: "image/png", bytes: png },
      }),
      fakeTransport(companion, {
        status: "attached",
        source: companion,
        payload: { filename: "comp.png", mime: "image/png", bytes: png },
      }),
    ],
  })
  const outcome = await broker.request("companion")
  expect(outcome.payload?.filename).toBe("comp.png")
})

test("denial short-circuits with denied status", async () => {
  const broker = createAttachmentBroker({
    transports: () => [
      fakeTransport(clipboard, { status: "denied", source: clipboard }),
      fakeTransport(companion, {
        status: "attached",
        source: companion,
        payload: { filename: "x", mime: "image/png", bytes: png },
      }),
    ],
  })
  expect((await broker.request()).status).toBe("denied")
})

test("all-empty yields empty, unavailable records unsupported", async () => {
  const off = fakeTransport(clipboard, { status: "empty", source: clipboard }, false)
  const broker = createAttachmentBroker({
    transports: () => [off, fakeTransport(drop, { status: "empty", source: drop })],
  })
  const outcome = await broker.request()
  expect(outcome.status).toBe("empty")
  expect(outcome.attempts[0]?.status).toBe("unsupported")
})

test("throwing transport is recorded as failed without losing the cascade", async () => {
  const boom: AttachmentTransport = {
    source: clipboard,
    available: () => true,
    read: () => {
      throw new Error("socket down")
    },
  }
  const broker = createAttachmentBroker({
    transports: () => [
      boom,
      fakeTransport(drop, {
        status: "attached",
        source: drop,
        payload: { filename: "d", mime: "image/png", bytes: png },
      }),
    ],
  })
  const outcome = await broker.request()
  expect(outcome.status).toBe("attached")
  expect(outcome.attempts[0]?.status).toBe("failed")
})
