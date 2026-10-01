// Terminal-clipboard channel: fetches the clipboard that lives on the machine
// running the terminal emulator (the user's machine) over the pty itself, using
// the kitty OSC 5522 clipboard protocol with a legacy OSC 52 text-query
// fallback. This is the only standard escape mechanism that can carry image
// bytes across a plain SSH connection: the app writes a read request, the local
// terminal streams clipboard frames back as OSC responses.
//
// Wire facts below were verified against kitty's terminal-side implementation
// (kitty/clipboard.py):
//   request  = OSC 5522 <metadata> ';' <b64 of space-joined mime list>, where
//              metadata is ':'-joined key=value records (type=read, id, name).
//   response = OSC 5522 5522;type=read:status=<S>[:id=<id>][:mime=<b64>]
//              [;<b64 chunk>]; statuses OK (ack) -> DATA (per 4096-byte chunk,
//              each chunk base64-encoded independently, so each frame decodes
//              on its own and raw bytes concatenate) -> DONE, with
//              EPERM/ENOSYS/EINVAL/EIO/EFBIG failures.
//   a read request whose mime list is just "." returns the available clipboard
//   formats and kitty answers it WITHOUT a permission prompt, making it a
//   silent capability probe.
//   legacy   = OSC 52 ';' loc ';' '?' queries text only; the answer is
//              OSC 52 ';' loc ';' <b64 text>.
import type { Content } from "./clipboard"

const ESC = "\x1b"
const BEL = "\x07"
const ST = `${ESC}\\`

export const TERMINAL_CLIPBOARD_TIMEOUT_MS = 8000
export const TARGETS_PROBE_TIMEOUT_MS = 1000
// Rejected beyond a generous ceiling so a hostile terminal cannot stream
// unbounded data into memory; the server's own image cap is 5 MiB base64.
export const TERMINAL_CLIPBOARD_MAX_BYTES = 12 * 1024 * 1024

export type OscTerminal = Readonly<{
  subscribeOsc?(handler: (sequence: string) => void): () => void
  prependInputHandler?(handler: (sequence: string) => boolean): void
  removeInputHandler?(handler: (sequence: string) => boolean): void
}>

export function encodeOsc5522Read(input: Readonly<{ id: string; mimes: readonly string[]; humanName?: string }>): string {
  const records = [`type=read`, `id=${input.id}`]
  if (input.humanName) records.push(`name=${b64(input.humanName)}`)
  return `${ESC}]5522;${records.join(":")};${b64(input.mimes.join(" "))}${BEL}`
}

export function encodeOsc52Query(): string {
  return `${ESC}]52;c;?${BEL}`
}

// tmux/screen DCS passthrough wrapping, same shape clipboard.ts uses for writes.
export function wrapForMultiplexer(sequence: string): string {
  return `${ESC}Ptmux;${sequence.split(ESC).join(ESC + ESC)}${ST}`
}

export type TerminalFrame =
  | Readonly<{ kind: "5522"; id: string; status: string; mime?: string; payload?: string }>
  | Readonly<{ kind: "52"; loc: string; payload: string }>

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64")
}

function decodeB64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8")
}

// Best-effort parse of one raw OSC unit (with or without `ESC]` prefix /
// terminator: idle-flushes from the input parser can deliver partials).
export function parseTerminalFrame(raw: string): TerminalFrame | undefined {
  let body = raw.startsWith(`${ESC}]`) ? raw.slice(2) : raw.startsWith("]") ? raw.slice(1) : raw
  if (body.endsWith(BEL)) body = body.slice(0, -1)
  else if (body.endsWith(ST)) body = body.slice(0, -2)
  const separator = body.indexOf(";")
  const code = separator === -1 ? body : body.slice(0, separator)
  const rest = separator === -1 ? "" : body.slice(separator + 1)
  if (code === "52") {
    const fields = rest.split(";")
    if (fields.length < 2 || fields[1] === "?") return
    return { kind: "52", loc: fields[0] ?? "c", payload: fields[1] ?? "" }
  }
  if (code !== "5522") return
  const marker = rest.indexOf(";")
  const metadata = marker === -1 ? rest : rest.slice(0, marker)
  const payload = marker === -1 ? undefined : rest.slice(marker + 1)
  const fields: Record<string, string> = {}
  for (const record of metadata.split(":")) {
    const index = record.indexOf("=")
    if (index === -1) continue
    fields[record.slice(0, index)] = record.slice(index + 1)
  }
  if (fields.type !== "read") return
  return {
    kind: "5522",
    id: fields.id ?? "",
    status: fields.status ?? "",
    mime: fields.mime ? decodeB64(fields.mime) : undefined,
    payload: payload && payload.length ? payload : undefined,
  }
}

export type ReadOutcome =
  | Readonly<{ status: "content"; content: Content }>
  | Readonly<{ status: "targets"; mimes: readonly string[] }>
  | Readonly<{ status: "empty" }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "error"; code: string }>

// State machine over response frames for one request id. With `targets` it
// collects the "." mime payload into a mime list; otherwise the first accepted
// frame mime wins and its base64 chunks reassemble into a Content (base64 for
// images, decoded text for text/plain, mirroring clipboard.ts's Content rules).
export function createReadCollector(
  input: Readonly<{ id: string; prefer?: readonly string[]; targets?: boolean }>,
): Readonly<{ feed(raw: string): ReadOutcome | undefined; collect(): ReadOutcome | undefined }> {
  const chunks: Buffer[] = []
  let bytes = 0
  let mime = ""

  function finish(): ReadOutcome {
    if (!chunks.length) return { status: "empty" }
    const raw = Buffer.concat(chunks)
    if (input.targets) return { status: "targets", mimes: raw.toString("utf8").split(/\s+/).filter(Boolean) }
    if (mime === "text/plain") {
      const text = raw.toString("utf8")
      if (!text.trim().length) return { status: "empty" }
      return { status: "content", content: { data: text, mime: "text/plain" } }
    }
    return { status: "content", content: { data: raw.toString("base64"), mime } }
  }

  function accept(m: string | undefined): boolean {
    if (m === undefined) return chunks.length > 0
    if (input.targets) return m === "."
    if (!m.length || m === ".") return false
    if (mime) return m === mime
    const prefer = input.prefer ?? []
    return !prefer.length || prefer.includes(m) || (m.startsWith("image/") && prefer.some((x) => x.startsWith("image/")))
  }

  return {
    feed(raw: string) {
      const frame = parseTerminalFrame(raw)
      if (!frame) return
      if (frame.kind === "52") {
        if (input.targets) return
        if (mime && mime !== "text/plain") return
        const text = decodeB64(frame.payload)
        if (!text.trim().length) return
        return { status: "content", content: { data: text, mime: "text/plain" } }
      }
      if (frame.id !== input.id) return
      if (frame.status === "EPERM" || frame.status === "ENOSYS") return { status: "denied" }
      if (frame.status === "DONE") return finish()
      if (frame.status !== "DATA" && frame.status !== "OK") return
      if (!accept(frame.mime)) return
      if (!frame.payload) return
      if (!mime && frame.mime) mime = frame.mime
      bytes += Math.floor((frame.payload.length * 3) / 4)
      if (bytes > TERMINAL_CLIPBOARD_MAX_BYTES) return { status: "error", code: "EFBIG" }
      chunks.push(Buffer.from(frame.payload, "base64"))
    },
    collect() {
      return chunks.length ? finish() : undefined
    },
  }
}

// Preferred first, then any image/*, then anything else the clipboard offers.
export function pickMime(targets: readonly string[], prefer: readonly string[]): string | undefined {
  for (const entry of prefer) if (targets.includes(entry)) return entry
  return targets.find((entry) => entry.startsWith("image/")) ?? targets.find((entry) => entry !== ".") ?? targets[0]
}

export function randomReadId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export type TerminalClipboardOutcome = "content" | "denied" | "unsupported" | "empty" | "timeout" | "error"

export type TerminalClipboardAttempt = Readonly<{ outcome: TerminalClipboardOutcome; mime?: string; ms: number }>

let lastAttempt: TerminalClipboardAttempt | undefined
export function terminalClipboardLastAttempt() {
  return lastAttempt
}

let active: (() => void) | undefined

// Two-phase read: silent "." targets probe first (so a permission prompt only
// ever appears when the clipboard actually holds something pasteable), then a
// read request for the best mime. If the probe itself is ignored, fall back to
// the legacy text-only query, and finally to "unsupported".
export async function readTerminalClipboard(
  terminal: OscTerminal,
  options: Readonly<{
    prefer?: readonly string[]
    timeoutMs?: number
    probeTimeoutMs?: number
    humanName?: string
    write(sequence: string): void
  }>,
): Promise<Content | undefined> {
  const prefer = options.prefer ?? ["image/png", "image/jpeg", "text/plain"]
  const timeoutMs = options.timeoutMs ?? TERMINAL_CLIPBOARD_TIMEOUT_MS
  const probeTimeoutMs = options.probeTimeoutMs ?? TARGETS_PROBE_TIMEOUT_MS
  const humanName = options.humanName ?? "PrioriCode"
  const started = Date.now()
  active?.()

  return new Promise<Content | undefined>((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let feed: ((raw: string) => ReadOutcome | undefined) | undefined
    let cleanup = () => {}

    function settle(outcome: TerminalClipboardOutcome, content?: Content) {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      cleanup()
      if (active === cancel) active = undefined
      lastAttempt = { outcome, mime: content?.mime, ms: Date.now() - started }
      resolve(content)
    }

    function cancel() {
      settle("timeout")
    }
    active = cancel

    function start(next: { id: string; targets?: boolean }, ms: number, onTimeout: () => void) {
      const collector = createReadCollector({ id: next.id, prefer: next.targets ? undefined : prefer, targets: next.targets })
      feed = (raw) => collector.feed(raw)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const pending = collector.collect()
        if (pending?.status === "content") return settle("content", pending.content)
        onTimeout()
      }, ms)
      return collector
    }

    function request(id: string, mimes: readonly string[]) {
      options.write(encodeOsc5522Read({ id, mimes, humanName }))
    }

    function readData(mime: string) {
      const id = randomReadId()
      start({ id }, timeoutMs, () => settle("timeout"))
      request(id, [mime])
    }

    function ingest(raw: string) {
      if (done) return
      const result = feed?.(raw)
      if (!result) return
      if (result.status === "content") return settle("content", result.content)
      if (result.status === "denied") return settle("denied")
      if (result.status === "error") return settle("error")
      if (result.status === "targets") {
        const mime = result.mimes.length ? pickMime(result.mimes, prefer) : undefined
        if (!mime) return settle("empty")
        return readData(mime)
      }
      settle("empty")
    }

    // Single source: the input-handler path sees every response sequence,
    // including OSC units the parser idle-flushes as "unknown" chunks that
    // never reach subscribeOsc. Feeding both would double every DATA frame.
    const handler = (raw: string) => {
      ingest(raw)
      return false
    }
    terminal.prependInputHandler?.(handler)
    cleanup = () => terminal.removeInputHandler?.(handler)

    const probeId = randomReadId()
    start({ id: probeId, targets: true }, probeTimeoutMs, () => {
      // No 5522 answer: ask the legacy text-only query once, quietly.
      const collector = createReadCollector({ id: "" })
      feed = (raw) => collector.feed(raw)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => settle("unsupported"), timeoutMs)
      options.write(encodeOsc52Query())
    })
    request(probeId, ["."])
  })
}
