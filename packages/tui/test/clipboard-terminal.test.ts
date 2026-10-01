import { expect, test } from "bun:test"
import {
  createReadCollector,
  encodeOsc52Query,
  encodeOsc5522Read,
  parseTerminalFrame,
  pickMime,
  readTerminalClipboard,
  terminalClipboardLastAttempt,
  wrapForMultiplexer,
  type OscTerminal,
} from "../src/clipboard-terminal"

const ESC = "\x1b"

function b64(value: string) {
  return Buffer.from(value, "utf8").toString("base64")
}

function frame(id: string, status: string, extra?: { mime?: string; payload?: string }) {
  const records = [`type=read`, `status=${status}`]
  if (id) records.push(`id=${id}`)
  if (extra?.mime) records.push(`mime=${b64(extra.mime)}`)
  const body = `${ESC}]5522;${records.join(":")}`
  return (extra?.payload ? `${body};${extra.payload}` : body) + `${ESC}\\`
}

test("encodeOsc5522Read matches the kitty request shape", () => {
  const sequence = encodeOsc5522Read({ id: "abc123", mimes: ["image/png", "text/plain"], humanName: "PrioriCode" })
  expect(sequence).toBe(`${ESC}]5522;type=read:id=abc123:name=${b64("PrioriCode")};${b64("image/png text/plain")}\x07`)
  expect(encodeOsc5522Read({ id: "x", mimes: ["."] })).toBe(`${ESC}]5522;type=read:id=x;${b64(".")}\x07`)
})

test("encodeOsc52Query is the legacy text query", () => {
  expect(encodeOsc52Query()).toBe(`${ESC}]52;c;?\x07`)
})

test("wrapForMultiplexer doubles embedded escapes inside DCS passthrough", () => {
  expect(wrapForMultiplexer(`${ESC}]5522;x\x07`)).toBe(`${ESC}Ptmux;${ESC}${ESC}]5522;x\x07${ESC}\\`)
})

test("parseTerminalFrame handles 5522 units, terminators, and partials", () => {
  expect(parseTerminalFrame(frame("i1", "OK"))).toEqual({ kind: "5522", id: "i1", status: "OK", mime: undefined, payload: undefined })
  expect(parseTerminalFrame(`${ESC}]5522;type=read:status=DONE:id=i2\x07`)).toEqual({
    kind: "5522",
    id: "i2",
    status: "DONE",
    mime: undefined,
    payload: undefined,
  })
  const data = parseTerminalFrame(frame("i3", "DATA", { mime: "image/png", payload: "aGVsbG8=" }))
  expect(data).toEqual({ kind: "5522", id: "i3", status: "DATA", mime: "image/png", payload: "aGVsbG8=" })
  expect(parseTerminalFrame("5522;type=read:status=DONE:id=i4")).toEqual({
    kind: "5522",
    id: "i4",
    status: "DONE",
    mime: undefined,
    payload: undefined,
  })
  expect(parseTerminalFrame(`${ESC}]4;1;?${ESC}\\`)).toBeUndefined()
  expect(parseTerminalFrame(`${ESC}]52;c;?\x07`)).toBeUndefined()
  expect(parseTerminalFrame(`${ESC}]52;c;${b64("hi")}${ESC}\\`)).toEqual({ kind: "52", loc: "c", payload: b64("hi") })
  expect(parseTerminalFrame(`${ESC}]5522;type=write:status=OK\x07`)).toBeUndefined()
})

test("collector assembles chunked payloads across frames (image re-encoded once)", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5])
  const one = png.subarray(0, 6).toString("base64")
  const two = png.subarray(6).toString("base64")
  const collector = createReadCollector({ id: "c1", prefer: ["image/png"] })
  expect(collector.feed(frame("c1", "OK"))).toBeUndefined()
  expect(collector.feed(frame("c1", "DATA", { mime: "image/png", payload: one }))).toBeUndefined()
  expect(collector.feed(frame("c1", "DATA", { mime: "image/png", payload: two }))).toBeUndefined()
  const done = collector.feed(frame("c1", "DONE"))
  expect(done).toEqual({ status: "content", content: { data: png.toString("base64"), mime: "image/png" } })
})

test("collector ignores foreign ids and unwanted mimes", () => {
  const collector = createReadCollector({ id: "mine", prefer: ["text/plain"] })
  expect(collector.feed(frame("other", "DATA", { mime: "text/plain", payload: b64("nope") }))).toBeUndefined()
  expect(collector.feed(frame("mine", "DATA", { mime: "image/svg+xml", payload: b64("<svg/>") }))).toBeUndefined()
  expect(collector.feed(frame("mine", "DATA", { mime: "text/plain", payload: b64("yes ") }))).toBeUndefined()
  expect(collector.feed(frame("mine", "DONE"))).toEqual({ status: "content", content: { data: "yes ", mime: "text/plain" } })
})

test("collector decodes targets and errors", () => {
  const targets = createReadCollector({ id: "t1", targets: true })
  expect(targets.feed(frame("t1", "DATA", { mime: ".", payload: b64("image/png text/plain\n") }))).toBeUndefined()
  expect(targets.feed(frame("t1", "DONE"))).toEqual({ status: "targets", mimes: ["image/png", "text/plain"] })
  const denied = createReadCollector({ id: "d1", prefer: [] })
  expect(denied.feed(frame("d1", "EPERM"))).toEqual({ status: "denied" })
  const empty = createReadCollector({ id: "e1", targets: true })
  empty.feed(frame("e1", "OK"))
  expect(empty.feed(frame("e1", "DONE"))).toEqual({ status: "empty" })
})

test("collector accepts legacy osc52 answers", () => {
  const collector = createReadCollector({ id: "" })
  expect(collector.feed(`${ESC}]52;c;${b64("remote text")}\x07`)).toEqual({
    status: "content",
    content: { data: "remote text", mime: "text/plain" },
  })
})

test("pickMime prefers list, then any image, then anything", () => {
  expect(pickMime(["text/plain", "image/jpeg"], ["image/png", "image/jpeg", "text/plain"])).toBe("image/jpeg")
  expect(pickMime(["image/webp"], ["text/plain"])).toBe("image/webp")
  expect(pickMime(["text/html"], ["text/plain"])).toBe("text/html")
  expect(pickMime([], ["text/plain"])).toBeUndefined()
})

function fakeTerminal(): OscTerminal & { emit(raw: string): void; last(): boolean } {
  const handlers: ((raw: string) => boolean)[] = []
  return {
    prependInputHandler(handler) {
      handlers.unshift(handler)
    },
    removeInputHandler(handler) {
      const index = handlers.indexOf(handler)
      if (index >= 0) handlers.splice(index, 1)
    },
    emit(raw) {
      for (const handler of handlers) handler(raw)
    },
    last() {
      return handlers.length > 0
    },
  }
}

function requestId(sequence: string): string {
  const match = /id=([A-Za-z0-9]+)/.exec(sequence)
  if (!match) throw new Error(`no id in ${sequence}`)
  return match[1]!
}

test("readTerminalClipboard: probe then image read over two requests", async () => {
  const terminal = fakeTerminal()
  const written: string[] = []
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7])
  const promise = readTerminalClipboard(terminal, {
    write: (sequence) => void written.push(sequence),
    probeTimeoutMs: 50,
    timeoutMs: 500,
  })
  await Bun.sleep(0)
  expect(written.length).toBe(1)
  expect(written[0]).toContain(b64("."))
  const probeId = requestId(written[0]!)
  terminal.emit(frame(probeId, "OK"))
  terminal.emit(frame(probeId, "DATA", { mime: ".", payload: b64("image/png\n") }))
  terminal.emit(frame(probeId, "DONE"))
  await Bun.sleep(0)
  expect(written.length).toBe(2)
  expect(written[1]).toContain(b64("image/png"))
  const dataId = requestId(written[1]!)
  terminal.emit(frame(dataId, "DATA", { mime: "image/png", payload: png.subarray(0, 6).toString("base64") }))
  terminal.emit(frame(dataId, "DATA", { mime: "image/png", payload: png.subarray(6).toString("base64") }))
  terminal.emit(frame(dataId, "DONE"))
  const content = await promise
  expect(content).toEqual({ data: png.toString("base64"), mime: "image/png" })
  expect(terminal.last()).toBe(false)
  expect(terminalClipboardLastAttempt()?.outcome).toBe("content")
  expect(terminalClipboardLastAttempt()?.mime).toBe("image/png")
})

test("readTerminalClipboard: empty clipboard resolves undefined without a second request", async () => {
  const terminal = fakeTerminal()
  const written: string[] = []
  const promise = readTerminalClipboard(terminal, { write: (s) => void written.push(s), probeTimeoutMs: 50, timeoutMs: 300 })
  await Bun.sleep(0)
  terminal.emit(frame(requestId(written[0]!), "DONE"))
  expect(await promise).toBeUndefined()
  expect(written.length).toBe(1)
  expect(terminalClipboardLastAttempt()?.outcome).toBe("empty")
})

test("readTerminalClipboard: denial surfaces as denied outcome", async () => {
  const terminal = fakeTerminal()
  const written: string[] = []
  const promise = readTerminalClipboard(terminal, { write: (s) => void written.push(s), probeTimeoutMs: 50, timeoutMs: 300 })
  await Bun.sleep(0)
  const probeId = requestId(written[0]!)
  terminal.emit(frame(probeId, "DATA", { mime: ".", payload: b64("image/png\n") }))
  terminal.emit(frame(probeId, "DONE"))
  await Bun.sleep(0)
  terminal.emit(frame(requestId(written[1]!), "EPERM"))
  expect(await promise).toBeUndefined()
  expect(terminalClipboardLastAttempt()?.outcome).toBe("denied")
})

test("readTerminalClipboard: unsupported terminal falls back to legacy text query", async () => {
  const terminal = fakeTerminal()
  const written: string[] = []
  const promise = readTerminalClipboard(terminal, { write: (s) => void written.push(s), probeTimeoutMs: 20, timeoutMs: 300 })
  await Bun.sleep(30)
  expect(written.length).toBe(2)
  expect(written[1]).toBe(encodeOsc52Query())
  terminal.emit(`${ESC}]52;c;${b64("ssh text")}\x07`)
  expect(await promise).toEqual({ data: "ssh text", mime: "text/plain" })
  expect(terminalClipboardLastAttempt()?.outcome).toBe("content")
})

test("readTerminalClipboard: silence ends as unsupported and cleans up handlers", async () => {
  const terminal = fakeTerminal()
  const written: string[] = []
  const promise = readTerminalClipboard(terminal, { write: (s) => void written.push(s), probeTimeoutMs: 20, timeoutMs: 60 })
  expect(await promise).toBeUndefined()
  expect(terminalClipboardLastAttempt()?.outcome).toBe("unsupported")
  expect(terminal.last()).toBe(false)
})

test("readTerminalClipboard: a later paste supersedes the in-flight one", async () => {
  const terminal = fakeTerminal()
  const written: string[] = []
  const options = { write: (s: string) => void written.push(s), probeTimeoutMs: 500, timeoutMs: 2000 }
  const first = readTerminalClipboard(terminal, options)
  await Bun.sleep(0)
  const second = readTerminalClipboard(terminal, options)
  expect(await first).toBeUndefined()
  expect(terminalClipboardLastAttempt()?.outcome).toBe("timeout")
  terminal.emit(frame(requestId(written[written.length - 1]!), "DONE"))
  expect(await second).toBeUndefined()
})
