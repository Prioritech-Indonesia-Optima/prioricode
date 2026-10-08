// End-to-end OSC 5522 clipboard reads over REAL PTY byte streams, driving the
// same readTerminalClipboard pipeline the app uses. Includes a real tmux
// server with allow-passthrough: requests must be DCS-wrapped on the write
// path, and responses only reach the app when the outer terminal's replies
// survive the tmux input relay.
import { describe, expect, test } from "bun:test"
import {
  createReadCollector,
  encodeOsc5522Read,
  readTerminalClipboard,
  terminalClipboardLastAttempt,
  wrapForMultiplexer,
  type OscTerminal,
} from "../src/clipboard-terminal"
import { killTmuxServer, openPty, scriptAvailable, tmuxAvailable, tmuxBridge, type PtyBridge } from "./fixture/pty"

const bun = process.execPath
const responder = `${import.meta.dir}/fixture/osc-5522-terminal.ts`
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8])

const usesRealPty = scriptAvailable()
const usesTmux = scriptAvailable() && tmuxAvailable()

function driveRead(
  bridge: PtyBridge,
  options: Readonly<{
    multiplexer?: boolean
    prefer?: readonly string[]
    timeoutMs?: number
    probeTimeoutMs?: number
  }>,
) {
  const router = bridge.startInputRouter()
  const terminal: OscTerminal = {
    prependInputHandler: (handler) => void router.handlers.add(handler),
    removeInputHandler: (handler) => void router.handlers.delete(handler),
  }
  return readTerminalClipboard(terminal, {
    prefer: options.prefer,
    timeoutMs: options.timeoutMs,
    probeTimeoutMs: options.probeTimeoutMs,
    write: (sequence) => bridge.write(options.multiplexer ? wrapForMultiplexer(sequence) : sequence),
  }).finally(() => router.stop())
}

describe("terminal clipboard over a real PTY", () => {
  const ptyTest = usesRealPty ? test : test.skip

  async function openResponder(env?: Record<string, string>) {
    const bridge = openPty(`stty raw -echo; exec ${bun} ${responder}`, env)
    const ready = await bridge.waitForUnit((unit) => unit.includes("type=ready"), 8000)
    expect(ready).toBeDefined()
    return bridge
  }

  ptyTest("reads an image through a raw-PTY responder", async () => {
    const bridge = await openResponder()
    try {
      const content = await driveRead(bridge, { prefer: ["image/png"] })
      expect(content?.mime).toBe("image/png")
      expect(Buffer.from(content?.data ?? "", "base64")).toEqual(PNG)
      expect(terminalClipboardLastAttempt()?.outcome).toBe("content")
    } finally {
      bridge.kill()
      await bridge.closed()
    }
  })

  ptyTest("prefers text/plain when requested", async () => {
    const bridge = await openResponder()
    try {
      const content = await driveRead(bridge, { prefer: ["text/plain"] })
      expect(content).toEqual({ data: "clipboard text", mime: "text/plain" })
    } finally {
      bridge.kill()
      await bridge.closed()
    }
  })

  ptyTest("permission denial settles denied without content", async () => {
    const bridge = await openResponder({ RESPONDER_MODE: "deny" })
    try {
      const content = await driveRead(bridge, { prefer: ["image/png"] })
      expect(content).toBeUndefined()
      expect(terminalClipboardLastAttempt()?.outcome).toBe("denied")
    } finally {
      bridge.kill()
      await bridge.closed()
    }
  })

  ptyTest("unresponsive terminal settles unsupported", async () => {
    const bridge = await openResponder({ RESPONDER_MODE: "silent" })
    try {
      const content = await driveRead(bridge, { prefer: ["image/png"], timeoutMs: 1500, probeTimeoutMs: 600 })
      expect(content).toBeUndefined()
      expect(terminalClipboardLastAttempt()?.outcome).toBe("unsupported")
    } finally {
      bridge.kill()
      await bridge.closed()
    }
  })
})

describe("terminal clipboard through real tmux", () => {
  const tmuxTest = usesTmux ? test : test.skip

  // The pane's ready marker can be emitted before `attach` exists (pre-attach
  // output is dropped; attach only replays the painted screen, not raw bytes),
  // so readiness is polled instead: resend a wrapped targets probe until an
  // answer comes back through the full tmux round-trip. Env is embedded in the
  // pane command because a reused/inherited tmux server environment is not
  // guaranteed to reach panes.
  async function openTmux(label: string, env: string) {
    const conf = `${import.meta.dir}/fixture/tmux-${label}-${process.pid}.conf`
    await Bun.write(conf, "set -g allow-passthrough on\nset -s escape-time 0\n")
    const sock = `ptest${label}${process.pid}`
    const bridge = openPty(
      tmuxBridge({ conf, sock, name: "t", cols: 120, rows: 30, pane: `${env} ${bun} ${responder}` }),
    )
    const warm = createReadCollector({ id: "warm", targets: true })
    const request = wrapForMultiplexer(encodeOsc5522Read({ id: "warm", mimes: ["."] }))
    bridge.write(request)
    let up = false
    const deadline = Date.now() + 20000
    while (!up && Date.now() < deadline) {
      const unit = await bridge.nextUnit(500)
      if (unit === undefined) {
        bridge.write(request)
        continue
      }
      if (warm.feed(unit)?.status === "targets") up = true
    }
    return { bridge, sock, conf, up }
  }

  tmuxTest("DCS-wrapped request/response survives tmux with allow-passthrough", async () => {
    const { bridge, sock, conf, up } = await openTmux("roundtrip", "WRAP_OUT=1")
    try {
      expect(up).toBe(true)
      const content = await driveRead(bridge, { multiplexer: true, prefer: ["image/png"] })
      expect(content?.mime).toBe("image/png")
      expect(Buffer.from(content?.data ?? "", "base64")).toEqual(PNG)
      expect(terminalClipboardLastAttempt()?.outcome).toBe("content")
    } finally {
      bridge.kill()
      await bridge.closed()
      killTmuxServer(sock)
      await Bun.file(conf).unlink().catch(() => {})
    }
  })

  tmuxTest("unwrapped pane replies are eaten by tmux (negative control)", async () => {
    // Probe answers arrive wrapped (proving the pane is live and requests are
    // relayed), while DATA answers are emitted raw and eaten by tmux, so the
    // read gets targets then times out waiting for content.
    const { bridge, sock, conf, up } = await openTmux("negative", "WRAP_PROBE=1")
    try {
      expect(up).toBe(true)
      const content = await driveRead(bridge, {
        multiplexer: true,
        prefer: ["image/png"],
        timeoutMs: 1500,
        probeTimeoutMs: 600,
      })
      expect(content).toBeUndefined()
      expect(terminalClipboardLastAttempt()?.outcome).toBe("timeout")
    } finally {
      bridge.kill()
      await bridge.closed()
      killTmuxServer(sock)
      await Bun.file(conf).unlink().catch(() => {})
    }
  })
})
