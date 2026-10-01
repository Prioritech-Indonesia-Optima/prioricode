// Windows/remote clipboard scenario table. Single source of truth for the
// guide strings shown when a paste finds nothing or a copy had to fall back
// to the terminal escape sequence. Pure and injected so every scenario is
// testable without a terminal.
import { release } from "node:os"
import { detectWsl } from "./clipboard"

export type ClipboardSignals = Readonly<{
  platform: string
  wsl?: boolean
  remote?: boolean
  displayServer?: "wayland" | "x11"
  multiplexer?: "tmux" | "screen"
  terminal?: TerminalName
}>

export type TerminalName = "vscode" | "kitty" | "wezterm" | "ghostty" | "iterm" | "windows-terminal"

export type ScenarioId =
  | "win32-native"
  | "wsl"
  | "macos"
  | "linux-local"
  | "linux-remote"
  | "unknown-local"
  | "unknown-remote"

export type Scenario = Readonly<{
  id: ScenarioId
  pasteEmpty: string
  copyOsc52: string
  copyFailed: string
}>

export function detectTerminal(env: Readonly<Record<string, string | undefined>>): TerminalName | undefined {
  if (env.WT_SESSION) return "windows-terminal"
  const program = (env.TERM_PROGRAM ?? "").toLowerCase()
  if (program === "vscode") return "vscode"
  if (program === "kitty") return "kitty"
  if (program === "wezterm") return "wezterm"
  if (program === "ghostty") return "ghostty"
  if (program.includes("iterm")) return "iterm"
}

// tmux servers keep stale SSH_* variables after the original client detaches,
// so a display server or WSL marker vetoes "remote" even when SSH env is set.
export function clipboardSignals(
  env: Readonly<Record<string, string | undefined>> = process.env,
  kernelRelease: string = release(),
): ClipboardSignals {
  const wsl = detectWsl(kernelRelease, env)
  const displayServer = env.WAYLAND_DISPLAY ? "wayland" : env.DISPLAY ? "x11" : undefined
  return {
    platform: process.platform,
    wsl,
    remote: Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) && !displayServer && !wsl,
    displayServer,
    multiplexer: env.TMUX ? "tmux" : env.STY ? "screen" : undefined,
    terminal: detectTerminal(env),
  }
}

export function resolveScenario(signals: ClipboardSignals): ScenarioId {
  if (signals.platform === "win32") return "win32-native"
  if (signals.platform === "darwin") return "macos"
  if (signals.platform === "linux") {
    if (signals.wsl) return "wsl"
    if (signals.remote) return "linux-remote"
    return "linux-local"
  }
  return signals.remote ? "unknown-remote" : "unknown-local"
}

const OSC52_COPY = "Copied via terminal escape sequence (OSC 52) — paste into apps on your own machine"

// Terminals that implement the kitty clipboard protocol (OSC 5522): a remote
// Ctrl+V can pull clipboard bytes — including images — back over the pty.
export const PROTOCOL_CLIPBOARD_TERMINALS: readonly TerminalName[] = ["kitty", "wezterm", "ghostty"]

function remotePasteEmpty(terminal?: TerminalName, multiplexer?: "tmux" | "screen") {
  const parts = [
    "Remote session: your clipboard lives on the client machine, not this host.",
    multiplexer
      ? "Text: paste through your terminal (Ctrl+Shift+V or right-click), possibly bypassing tmux — tmux may also block the clipboard protocol."
      : "Text: paste with your terminal itself (Ctrl+Shift+V or right-click).",
  ]
  if (terminal && PROTOCOL_CLIPBOARD_TERMINALS.includes(terminal)) {
    parts.push(
      "Ctrl+V can fetch the clipboard through your terminal (a one-time permission popup may appear); if it comes back empty, your terminal may not support the clipboard protocol.",
    )
  } else if (terminal === "vscode") {
    parts.push("Install the PrioriCode VS Code extension: its Ctrl+V sends clipboard images into the terminal, locally and over Remote-SSH.")
  } else {
    parts.push("This terminal does not hand clipboard images to applications over SSH.")
  }
  parts.push("Always works: copy the file to the server (scp, WinSCP, MobaXterm drag) and paste its path to attach it.")
  return parts.join(" ")
}

const REMOTE_COPY_FAILED =
  "Copy failed on this host; in a remote session your terminal may still receive the text via OSC 52"

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  "win32-native": {
    id: "win32-native",
    pasteEmpty: "Clipboard has nothing pasteable",
    copyOsc52: OSC52_COPY,
    copyFailed: "Copy failed — the clipboard may be locked by another application",
  },
  wsl: {
    id: "wsl",
    pasteEmpty:
      "Windows clipboard is empty or PowerShell interop is unavailable from this WSL session — copy an image or file in Windows and try again",
    copyOsc52: OSC52_COPY,
    copyFailed: "Copy failed — check that powershell.exe is reachable from this WSL session",
  },
  macos: {
    id: "macos",
    pasteEmpty: "Clipboard has nothing pasteable",
    copyOsc52: OSC52_COPY,
    copyFailed: "Copy failed — osascript/pbpaste unavailable",
  },
  "linux-local": {
    id: "linux-local",
    pasteEmpty:
      "Clipboard has nothing pasteable — if paste keeps failing, install xclip (X11) or wl-clipboard (Wayland)",
    copyOsc52: OSC52_COPY,
    copyFailed: REMOTE_COPY_FAILED,
  },
  "linux-remote": {
    id: "linux-remote",
    pasteEmpty: remotePasteEmpty(),
    copyOsc52: OSC52_COPY,
    copyFailed: REMOTE_COPY_FAILED,
  },
  "unknown-local": {
    id: "unknown-local",
    pasteEmpty: "Clipboard has nothing pasteable",
    copyOsc52: OSC52_COPY,
    copyFailed: "Copy failed — no clipboard tool found for this platform",
  },
  "unknown-remote": {
    id: "unknown-remote",
    pasteEmpty: remotePasteEmpty(),
    copyOsc52: OSC52_COPY,
    copyFailed: REMOTE_COPY_FAILED,
  },
}

export function scenarioFor(signals: ClipboardSignals): Scenario {
  return SCENARIOS[resolveScenario(signals)]
}

export function pasteMissHint(signals: ClipboardSignals): string {
  if (signals.remote) return remotePasteEmpty(signals.terminal, signals.multiplexer)
  return scenarioFor(signals).pasteEmpty
}
