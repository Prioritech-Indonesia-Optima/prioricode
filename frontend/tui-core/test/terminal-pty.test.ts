// Real PTY test for the tui-core Terminal device. Drives the raw-mode read
// loop and input parser over actual terminal bytes (util-linux `script` PTY +
// stty-raw probe program that NDJSON-emits every decoded event), the layer
// that fake-object tests could never cover.
import { expect, test } from "bun:test"

type Line = Readonly<{
  type: string
  event?: {
    kind: string
    name?: string
    ctrl?: boolean
    text?: string
    button?: number
    x?: number
    y?: number
    data?: string
    code?: number
  }
  data?: string
  columns?: number
  rows?: number
}>

const usesPty = process.platform === "linux" && Bun.which("script") !== null
const pty = usesPty ? test : test.skip

async function runDevice(inputBytes: string): Promise<Line[]> {
  const lines: Line[] = []
  const proc = Bun.spawn(
    [
      "script",
      "-q",
      "-e",
      "-c",
      `stty raw -echo; exec ${process.execPath} run ${import.meta.dir}/fixture/terminal-device.ts`,
      "/dev/null",
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "ignore" },
  )
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const readTask = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const nl = buffer.indexOf("\n")
        if (nl === -1) break
        const line = buffer.slice(0, nl).replace(/\r$/, "")
        buffer = buffer.slice(nl + 1)
        if (!line.length) continue
        try {
          lines.push(JSON.parse(line) as Line)
        } catch {}
      }
    }
  })()
  // Gate on the device's ready line: bun boot + stty raw takes a moment and
  // canonical line discipline would swallow newline-less input before then.
  const deadline = Date.now() + 6000
  while (!lines.some((l) => l.type === "ready") && Date.now() < deadline) await Bun.sleep(10)
  await proc.stdin.write(inputBytes)
  await Bun.sleep(150)
  try {
    proc.kill()
  } catch {}
  await Promise.race([readTask, Bun.sleep(200)])
  return lines
}

pty("device boots raw mode and reports the real size", async () => {
  const lines = await runDevice("")
  const ready = lines.find((l) => l.type === "ready")
  expect(ready !== undefined).toBe(true)
})

pty("typed characters decode through the parser", async () => {
  const lines = await runDevice("hi\r")
  const names = lines.filter((l) => l.type === "event" && l.event?.kind === "key").map((l) => l.event?.name)
  expect(names).toContain("h")
  expect(names).toContain("i")
  expect(names).toContain("enter")
})

pty("ctrl+c decodes as legacy control key", async () => {
  const lines = await runDevice("\x03")
  const key = lines.find((l) => l.type === "event")?.event
  expect(key?.ctrl).toBe(true)
})

pty("arrow keys decode legacy CSI and SGR-mouse arrives", async () => {
  const lines = await runDevice("\x1b[A\x1b[<0;12;5M")
  const events = lines.filter((l) => l.type === "event").map((l) => l.event)
  expect(events.some((e) => e?.kind === "key" && e.name === "up")).toBe(true)
  expect(events.some((e) => e?.kind === "mouse" && e.button === 0 && e.x === 11 && e.y === 4)).toBe(true)
})

pty("bracketed paste arrives as one paste event", async () => {
  const lines = await runDevice("\x1b[200~pasted text\x1b[201~")
  const paste = lines.find((l) => l.type === "event" && l.event?.kind === "paste")
  expect(paste?.event?.text).toBe("pasted text")
})

pty("OSC 5522 response bytes reach the osc channel", async () => {
  const lines = await runDevice("\x1b]5522;type=read:status=OK:id=x1\x07")
  const unit = lines.find((l) => l.type === "osc5522")
  expect(unit?.data).toBe("type=read:status=OK:id=x1")
})
