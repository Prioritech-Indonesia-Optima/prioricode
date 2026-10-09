// Real-terminal probe program: boots the tui-core Terminal under a PTY and
// reports every parsed input event (plus OSC 5522 answers and size) as one
// NDJSON line on stdout, so the test parent can drive actual bytes through
// the raw-mode read loop and assert the decoded event stream.
import { writeSync } from "node:fs"
import { createTerminal } from "../../src/io/terminal"

const emit = (value: unknown) => writeSync(1, JSON.stringify(value) + "\n")

const terminal = createTerminal({ mouse: true })
terminal.onInput((event) => {
  emit({ type: "event", event })
})
terminal.onResize((columns, rows) => emit({ type: "size", columns, rows }))
terminal.osc.on(5522, (data) => emit({ type: "osc5522", data }))

await terminal.start()
emit({ type: "ready", columns: terminal.columns, rows: terminal.rows, multiplexer: terminal.multiplexer ?? null })

const keepAlive = setInterval(() => {}, 1000)
process.on("SIGTERM", () => {
  clearInterval(keepAlive)
  terminal.stop()
  process.exit(0)
})
