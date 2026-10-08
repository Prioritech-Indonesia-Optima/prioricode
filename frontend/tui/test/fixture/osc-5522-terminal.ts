import { wrapForMultiplexer } from "../../src/clipboard-terminal"

// Raw line discipline is mandatory: OSC units carry no newline, and a cooked
// pane TTY would hold input in canonical buffers forever.
Bun.spawnSync({ cmd: ["stty", "raw", "-echo"], stdin: "inherit", stdout: "ignore", stderr: "ignore" })

// Real "terminal emulator" stand-in for PTY/tmux integration tests: answers
// OSC 5522 clipboard read requests with OK/DATA/DONE frames. Runs as the pane
// process; RESPONDER_MODE=deny answers EPERM, silent never answers.
// WRAP_OUT=1 DCS-wraps replies so tmux forwards them to the outer stream
// (raw pane output is eaten by tmux; this mirrors a real outer terminal,
// which writes replies unwrapped and only tmux->outside requests need the
// wrapper). A ready marker frame is emitted on start so tests can wait out
// process boot before writing requests.
import { readSync, writeSync } from "node:fs"

const MODE = process.env.RESPONDER_MODE ?? "answer"
const WRAP = process.env.WRAP_OUT === "1"
const WRAP_PROBE = WRAP || process.env.WRAP_PROBE === "1"
const out = (s: string) => writeSync(1, WRAP ? wrapForMultiplexer(s) : s)
const outProbe = (s: string) => writeSync(1, WRAP_PROBE ? wrapForMultiplexer(s) : s)

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8])
const b64 = (v: Uint8Array | string) => Buffer.from(v).toString("base64")

function frame(id: string, status: string, extra?: { mime?: string; payload?: string }) {
  const records = ["type=read", `status=${status}`]
  if (id) records.push(`id=${id}`)
  if (extra?.mime) records.push(`mime=${b64(extra.mime)}`)
  const body = `\x1b]5522;${records.join(":")}`
  return (extra?.payload ? `${body};${extra.payload}` : body) + "\x07"
}

function handle(unit: string) {
  if (MODE === "silent") return
  let body = unit.startsWith("\x1b]") ? unit.slice(2) : unit
  if (body.endsWith("\x07")) body = body.slice(0, -1)
  else if (body.endsWith("\x1b\\")) body = body.slice(0, -2)
  const sep = body.indexOf(";")
  if (sep === -1 || body.slice(0, sep) !== "5522") return
  const rest = body.slice(sep + 1)
  const marker = rest.indexOf(";")
  const metadata = marker === -1 ? rest : rest.slice(0, marker)
  const payload = marker === -1 ? "" : rest.slice(marker + 1)
  const fields: Record<string, string> = {}
  for (const record of metadata.split(":")) {
    const i = record.indexOf("=")
    if (i !== -1) fields[record.slice(0, i)] = record.slice(i + 1)
  }
  if (fields.type !== "read") return
  const id = fields.id ?? ""
  const mimes = Buffer.from(payload, "base64").toString("utf8").split(/\s+/).filter(Boolean)
  if (MODE === "deny") {
    out(frame(id, "EPERM"))
    return
  }
  if (mimes.length === 1 && mimes[0] === ".") {
    outProbe(frame(id, "OK"))
    outProbe(frame(id, "DATA", { mime: ".", payload: b64("image/png text/plain") }))
    outProbe(frame(id, "DONE"))
    return
  }
  if (mimes.includes("image/png")) {
    out(frame(id, "OK"))
    out(frame(id, "DATA", { mime: "image/png", payload: b64(PNG.subarray(0, 8)) }))
    out(frame(id, "DATA", { mime: "image/png", payload: b64(PNG.subarray(8)) }))
    out(frame(id, "DONE"))
    return
  }
  if (mimes.includes("text/plain")) {
    out(frame(id, "OK"))
    out(frame(id, "DATA", { mime: "text/plain", payload: b64("clipboard text") }))
    out(frame(id, "DONE"))
    return
  }
  out(frame(id, "DONE"))
}

const READY = "\x1b]5522;type=ready\x07"
writeSync(1, WRAP || process.env.READY_WRAP === "1" ? wrapForMultiplexer(READY) : READY)

const decoder = new TextDecoder()
let buffer = ""
const readBuf = Buffer.alloc(4096)
for (;;) {
  let n = 0
  try {
    n = readSync(0, readBuf, 0, readBuf.length, null)
  } catch {
    break
  }
  if (n <= 0) break
  buffer += decoder.decode(readBuf.subarray(0, n), { stream: true })
  for (;;) {
    const start = buffer.indexOf("\x1b]")
    if (start === -1) {
      buffer = ""
      break
    }
    const end = buffer.indexOf("\x07", start)
    const st = buffer.indexOf("\x1b\\", start)
    let stop = -1
    if (end !== -1 && (st === -1 || end < st)) stop = end + 1
    else if (st !== -1) stop = st + 2
    if (stop === -1) break
    handle(buffer.slice(start, stop))
    buffer = buffer.slice(stop)
  }
}
