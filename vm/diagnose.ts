// Diagnose: why Ctrl+V paste from a Windows terminal to a Linux host (over SSH)
// does not work in PrioriCode.
//
// This runs INSIDE the small VM (a headless Linux "remote host") and drives the
// REAL paste modules from packages/tui, so the diagnosis reflects the shipped
// code, not a re-implementation:
//   - clipboard-terminal.ts  (kitty OSC 5522 + OSC 52 read state machine)
//   - clipboard.ts           (host clipboard read)
//   - clipboard-scenario.ts  (remote/local scenario + miss hint)
//
// The "terminal" (the user's Windows machine) is simulated in-process: a fake
// OscTerminal whose write() parses the outgoing escape sequences and, per a
// terminal model, answers them the way a real terminal would. The "remote host"
// environment is the container itself (no X11/Wayland, no xclip/wl-paste).
//
// The fundamentals only (no SSH bridge / paste-serve daemon): text arrives via
// the terminal's own bracketed paste; images need the terminal protocol or the
// host clipboard.

import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  readTerminalClipboard,
  encodeOsc52Query,
  terminalClipboardLastAttempt,
  type OscTerminal,
} from "../packages/tui/src/clipboard-terminal"
import { readClipboard, type ClipboardEnvironment, type Content } from "../packages/tui/src/clipboard"
import { clipboardSignals, resolveScenario, pasteMissHint } from "../packages/tui/src/clipboard-scenario"
import { pasteDirectory, savePastedImage } from "../packages/tui/src/component/prompt/paste-store"

const ESC = "\x1b"
const BEL = "\x07"
const ST = `${ESC}\\`

// A 1x1 transparent PNG (valid image bytes, so a real sniff would accept it).
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const CLIP_TEXT = "hello from the Windows clipboard"

// ---------------------------------------------------------------------------
// Terminal simulator (reuses the repo's fakeTerminal/frame pattern from
// packages/tui/test/clipboard-terminal.test.ts).
// ---------------------------------------------------------------------------

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64")
}

function frame5522(id: string, status: string, extra?: { mime?: string; payload?: string }): string {
  const records = [`type=read`, `status=${status}`]
  if (id) records.push(`id=${id}`)
  if (extra?.mime) records.push(`mime=${b64(extra.mime)}`)
  const body = `${ESC}]5522;${records.join(":")}`
  return (extra?.payload ? `${body};${extra.payload}` : body) + ST
}

function frame52(payloadB64: string): string {
  return `${ESC}]52;c;${payloadB64}${BEL}`
}

// Parse an outgoing OSC 5522 read request (type=read) into { id, mimes }.
function parseReadRequest(seq: string): { id: string; mimes: string[] } | undefined {
  const match = seq.match(/\x1b\]5522;(.+)\x07/s)
  if (!match) return undefined
  const body = match[1]
  const sep = body.indexOf(";")
  const meta = sep === -1 ? body : body.slice(0, sep)
  const mimesB64 = sep === -1 ? "" : body.slice(sep + 1)
  if (!meta.startsWith("type=read")) return undefined
  const fields: Record<string, string> = {}
  for (const record of meta.split(":")) {
    const i = record.indexOf("=")
    if (i >= 0) fields[record.slice(0, i)] = record.slice(i + 1)
  }
  const mimes = mimesB64 ? Buffer.from(mimesB64, "base64").toString("utf8").split(/\s+/).filter(Boolean) : []
  return { id: fields.id ?? "", mimes }
}

type TerminalModel = "windows-terminal" | "kitty"
type Clip = { text?: string; imageB64?: string }

// Build a fake terminal that answers escape sequences the way `model` would.
//   windows-terminal: no kitty OSC 5522 read, no OSC 52 read/query (only write).
//   kitty:            answers the "." targets probe, then OK/DATA/DONE reads.
function makeTerminal(model: TerminalModel, clip: Clip): { term: OscTerminal; write: (seq: string) => void } {
  let handler: ((raw: string) => boolean) | undefined
  const term: OscTerminal = {
    prependInputHandler(h) {
      handler = h
    },
    removeInputHandler(h) {
      if (handler === h) handler = undefined
    },
  }
  const emit = (frames: string[]) => {
    // A real terminal answers after a round-trip; defer so it lands after the
    // current synchronous write, exactly like the pty would deliver it.
    for (const frame of frames) setTimeout(() => handler?.(frame), 0)
  }
  const write = (seq: string) => {
    if (model === "windows-terminal") return
    const request = parseReadRequest(seq)
    if (request) {
      if (request.mimes.includes(".")) {
        const mimes = Array.from(new Set([clip.imageB64 ? "image/png" : "text/plain", "text/plain"])).join(" ")
        emit([
          frame5522(request.id, "OK"),
          frame5522(request.id, "DATA", { mime: ".", payload: b64(mimes) }),
          frame5522(request.id, "DONE"),
        ])
        return
      }
      const mime = request.mimes[0] ?? "text/plain"
      const payload = mime === "text/plain" ? b64(clip.text ?? "") : clip.imageB64 ?? ""
      emit([frame5522(request.id, "OK"), frame5522(request.id, "DATA", { mime, payload }), frame5522(request.id, "DONE")])
      return
    }
    if (seq.includes(encodeOsc52Query())) {
      if (clip.text) emit([frame52(b64(clip.text))])
    }
  }
  return { term, write }
}

// ---------------------------------------------------------------------------
// Host clipboard environment. `has`/`run` probe the REAL container so the host
// channel genuinely reflects this VM (headless -> no tools -> fails).
// ---------------------------------------------------------------------------

function probeTool(name: string): boolean {
  const result = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" })
  return result.status === 0 && (result.stdout ?? "").trim().length > 0
}

function hostEnvironment(overrides?: Partial<ClipboardEnvironment>): ClipboardEnvironment {
  const tools: Record<string, boolean> = {
    "wl-paste": probeTool("wl-paste"),
    xclip: probeTool("xclip"),
    xsel: probeTool("xsel"),
  }
  const run =
    overrides?.run ??
    (async (command: string, args?: readonly string[]) => {
      try {
        const quoted = [command, ...(args ?? [])].map((part) => `"${part.replace(/"/g, '\\"')}"`).join(" ")
        const out = spawnSync("sh", ["-c", quoted], { encoding: "buffer", timeout: 2000, maxBuffer: 16 * 1024 * 1024 })
        return out.status === 0 && out.stdout ? out.stdout : Buffer.alloc(0)
      } catch {
        return Buffer.alloc(0)
      }
    })
  return {
    platform: "linux",
    wsl: false,
    tmp: "/tmp",
    has: overrides?.has ?? ((name) => tools[name]),
    run,
    read: (file) => readFile(file),
    remove: (file) => rm(file, { force: true }),
  }
}

// ---------------------------------------------------------------------------
// The exact prompt.paste decision (packages/tui/src/component/prompt/index.tsx):
//   terminal protocol (kitty/OSC52) -> host clipboard. Fundamentals only.
// ---------------------------------------------------------------------------

type Channel = "protocol" | "host" | "miss"

async function runPasteDecision(opts: {
  remote: boolean
  multiplexer?: "tmux" | "screen"
  term: OscTerminal
  write: (seq: string) => void
  hostRead: () => Promise<Content | undefined>
}): Promise<{ channel: Channel; content?: Content }> {
  const terminalChannel = opts.remote && !opts.multiplexer
  if (terminalChannel) {
    const terminal = await readTerminalClipboard(opts.term, { write: opts.write })
    if (terminal) return { channel: "protocol", content: terminal }
  }
  const host = await opts.hostRead()
  if (host) return { channel: "host", content: host }
  return { channel: "miss" }
}

// ---------------------------------------------------------------------------
// Bracketed paste: the text path a terminal delivers natively over the pty,
// independent of the channels above (packages/tui/src/component/prompt/index.tsx).
// ---------------------------------------------------------------------------

function decodePasteBytes(bytes: string): string {
  return bytes
}
function bracketedPaste(raw: string): string {
  const start = raw.indexOf(`${ESC}[200~`)
  const end = raw.indexOf(`${ESC}[201~`)
  if (start === -1 || end === -1) return ""
  const inner = raw.slice(start + 6, end)
  // Mirror prompt/index.tsx (CRLF then CR -> LF).
  return decodePasteBytes(inner).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

function line(char = "─", width = 78): string {
  return char.repeat(width)
}
function label(value: string, width = 22): string {
  return `  ${value.padEnd(width)}`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Model a remote SSH session on a headless host: SSH_* set, no display server.
  process.env.SSH_CONNECTION = "203.0.113.10 22 198.51.100.23 51234"
  process.env.SSH_TTY = "/dev/pts/0"
  delete process.env.DISPLAY
  delete process.env.WAYLAND_DISPLAY

  const signals = clipboardSignals()
  const scenario = resolveScenario(signals)

  console.log(line("═"))
  console.log("  PrioriCode — Windows → Linux Ctrl+V paste diagnosis")
  console.log(line("═"))
  console.log(label("VM (remote host):"), `headless linux, ${scenario}`)
  console.log(label("clipboard tools:"), ["xclip", "wl-paste", "xsel"].filter(probeTool).join(", ") || "none (headless)")
  console.log(label("remote detected:"), String(signals.remote))
  if (!signals.remote) {
    console.log("  WARNING: remote not detected — the matrix below would be wrong.")
  }
  console.log(line())

  const hostRead = () => readClipboard(hostEnvironment())

  // --- Remote matrix (the user's scenario): image clipboard over SSH --------
  console.log("\n  REMOTE — image on the Windows clipboard, Ctrl+V in the TUI")
  console.log(line())
  console.log("  " + "terminal".padEnd(20) + "result")
  console.log(line("·"))

  const remoteCases: TerminalModel[] = ["windows-terminal", "kitty"]

  let missRow: { channel: Channel; content?: Content } | undefined
  for (const terminal of remoteCases) {
    const { term, write } = makeTerminal(terminal, { imageB64: TINY_PNG_B64, text: CLIP_TEXT })
    const result = await runPasteDecision({ remote: true, term, write, hostRead })
    const mime = result.content?.mime ?? "—"
    console.log("  " + terminal.padEnd(20) + `${result.channel} (${mime})`)
    if (result.channel === "miss") {
      missRow = result
      const attempt = terminalClipboardLastAttempt()
      if (attempt) {
        console.log(
          "      ↳ the terminal-protocol probe sat for ~" +
            Math.round(attempt.ms / 1000) +
            "s before giving up — the 'stuck' feeling on Ctrl+V.",
        )
      }
    }
  }

  // --- Text path: bracketed paste (terminal-native) -------------------------
  console.log(line())
  const winText = bracketedPaste(`${ESC}[200~${CLIP_TEXT.replace(/\n/g, "\r\n")}${ESC}[201~]`)
  console.log("  " + "text (any terminal)".padEnd(20) + `bracketed paste (native) — recovered: "${winText}"`)
  console.log("      text is delivered by the terminal itself over the pty; it does not")
  console.log("      depend on the channels above. This is why TEXT often works.")

  // --- Host clipboard channel (contrast) ------------------------------------
  console.log(line())
  const localWithXclip = await readClipboard(
    hostEnvironment({
      has: (name) => name === "xclip",
      run: async (command) => (command === "xclip" ? Buffer.from("local host text") : Buffer.alloc(0)),
    }),
  )
  const headless = await readClipboard(hostEnvironment())
  console.log(
    "  " +
      "host clipboard".padEnd(20) +
      `local+xclip: ${localWithXclip?.mime ?? "miss"}   |   headless remote: ${headless?.mime ?? "miss"}`,
  )

  // --- Landing seam: every delivered image becomes a private file on the box --
  console.log(line())
  const stateDir = await mkdtemp(path.join(tmpdir(), "prioricode-paste-state-"))
  const directory = pasteDirectory(stateDir)
  const landed = await savePastedImage({ directory, mime: "image/png", base64: TINY_PNG_B64 })
  const landedBytes = await readFile(landed)
  const landedMode = (await stat(landed)).mode & 0o777
  const dirMode = (await stat(directory)).mode & 0o777
  console.log("  " + "image landing".padEnd(20) + directory + "/" + path.basename(landed))
  console.log(
    "      file mode " +
      landedMode.toString(8) +
      ", dir mode " +
      dirMode.toString(8) +
      `, ${landedBytes.length} bytes — attach references this path.`,
  )
  console.log("      All sources (host read / OSC 5522 / VS Code upload POST) converge here, so a")
  console.log("      pasted image is always a real file on the box. Production uses the private")
  console.log("      state dir — never world-readable /tmp.")
  await rm(stateDir, { recursive: true, force: true })

  // --- Root cause -----------------------------------------------------------
  console.log("\n" + line("═"))
  console.log("  WHY Windows → Linux Ctrl+V (image) fails")
  console.log(line("═"))
  const hint = pasteMissHint({ ...signals, terminal: "windows-terminal" })
  console.log("  1. On a remote session the clipboard lives on the CLIENT, not this Linux host.")
  console.log("  2. Channel 1 (terminal protocol) needs the terminal to ANSWER a clipboard")
  console.log("     read. Windows Terminal implements neither the kitty protocol (OSC 5522)")
  console.log("     nor OSC 52 read/query (only OSC 52 *write*) -> no answer -> timeout.")
  console.log("  3. Channel 2 (host clipboard) needs xclip/wl-paste + a display server; a")
  console.log("     headless remote host has neither -> empty.")
  console.log("  => No channel can pull the image, so Ctrl+V misses. TEXT still works via")
  console.log("     the terminal's own bracketed paste, which is why it feels 'half-broken'.")
  console.log(line())
  console.log("  User-facing hint PrioriCode shows in this exact case:")
  for (const sentence of hint.match(/[^.]+\.?/g) ?? [hint]) {
    console.log("    • " + sentence.trim())
  }
  console.log(line())
  console.log("  Fixes (any one): (a) use a terminal that answers the kitty protocol")
  console.log("  (kitty/ghostty/wezterm), (b) use the PrioriCode VS Code extension, or")
  console.log("  (c) copy the file to the host (scp, WinSCP) and paste its path.")
  console.log("  Whatever carries the bytes, they now land as a private file on the box and")
  console.log("  the prompt attaches that path — one uniform result for local and remote.")
  console.log(line("═"))

  // Sanity assertions so the VM is self-verifying.
  const problems: string[] = []
  if (!signals.remote) problems.push("remote not detected")
  if (!missRow) problems.push("expected a miss row (windows-terminal)")
  if (winText !== CLIP_TEXT) problems.push(`bracketed paste recovered wrong text: ${winText}`)
  if (localWithXclip?.mime !== "text/plain") problems.push("host channel with xclip did not return text")
  if (headless !== undefined) problems.push("headless host read unexpectedly returned content")
  if (landedMode !== 0o600) problems.push("landed image file not mode 0600")
  if (dirMode !== 0o700) problems.push("landing dir not mode 0700")
  if (!landedBytes.equals(Buffer.from(TINY_PNG_B64, "base64"))) problems.push("landed bytes differ from delivered image")
  if (problems.length) {
    console.error(`\n  SELF-CHECK FAILED: ${problems.join("; ")}`)
    process.exitCode = 1
  } else {
    console.log("\n  SELF-CHECK PASSED — matrix matches the grounded terminal facts.")
  }
  // One-shot diagnostic: exit explicitly so a lingering handle cannot hold the loop open.
  process.exit(process.exitCode ?? 0)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
