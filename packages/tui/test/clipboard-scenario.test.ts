import { expect, test } from "bun:test"
import { REMOTE_PASTE_DISABLED, clipboardSignals, detectTerminal, pasteMissHint, resolveScenario, SCENARIOS } from "../src/clipboard-scenario"

test("resolveScenario covers the Windows/remote matrix", () => {
  expect(resolveScenario({ platform: "win32" })).toBe("win32-native")
  expect(resolveScenario({ platform: "darwin" })).toBe("macos")
  expect(resolveScenario({ platform: "linux", displayServer: "x11" })).toBe("linux-local")
  expect(resolveScenario({ platform: "linux", wsl: true, remote: true })).toBe("wsl")
  expect(resolveScenario({ platform: "linux", remote: true })).toBe("linux-remote")
  expect(resolveScenario({ platform: "freebsd", remote: true })).toBe("unknown-remote")
  expect(resolveScenario({ platform: "freebsd" })).toBe("unknown-local")
})

test("clipboardSignals: SSH env alone means remote; display or WSL vetoes it", () => {
  const ssh = { SSH_CONNECTION: "1.2.3.4 5 6 22" }
  expect(clipboardSignals(ssh, "6.8.0-generic").remote).toBe(true)
  expect(clipboardSignals({ ...ssh, DISPLAY: ":0" }, "6.8.0-generic").remote).toBe(false)
  expect(clipboardSignals({ ...ssh, WAYLAND_DISPLAY: "wayland-0" }, "6.8.0-generic").remote).toBe(false)
  expect(clipboardSignals({ ...ssh, WSL_DISTRO_NAME: "Ubuntu" }, "5.15-microsoft-standard-WSL2").remote).toBe(false)
  expect(clipboardSignals({ ...ssh, WSL_DISTRO_NAME: "Ubuntu" }, "5.15-microsoft-standard-WSL2").wsl).toBe(true)
  expect(clipboardSignals({ TMUX: "/tmp/tmux-1000/default,1,0" }, "6.8.0-generic").multiplexer).toBe("tmux")
  expect(clipboardSignals({}, "6.8.0-139-generic (buildd@lcy02)").remote).toBe(false)
})

test("remote paste miss names the exact remedy", () => {
  const message = pasteMissHint({ platform: "linux", remote: true })
  expect(message).toContain("Remote session")
  expect(message).toContain("does not hand clipboard images")
  expect(message).toContain("scp")
  expect(message).not.toContain("paste-serve")
  expect(SCENARIOS["linux-remote"].copyOsc52).toContain("OSC 52")
})

test("terminal-aware remote guidance", () => {
  expect(detectTerminal({ TERM_PROGRAM: "vscode" })).toBe("vscode")
  expect(detectTerminal({ TERM_PROGRAM: "iTerm.app" })).toBe("iterm")
  expect(detectTerminal({ WT_SESSION: "abc" })).toBe("windows-terminal")
  expect(detectTerminal({})).toBeUndefined()
  expect(pasteMissHint({ platform: "linux", remote: true, terminal: "vscode" })).toContain(
    "PrioriCode VS Code extension",
  )
  expect(pasteMissHint({ platform: "linux", remote: true, terminal: "vscode" })).toContain("drag")
  const kitty = pasteMissHint({ platform: "linux", remote: true, terminal: "kitty" })
  expect(kitty).toContain("permission popup")
  expect(kitty).toContain("Ctrl+V can fetch the clipboard")
  expect(pasteMissHint({ platform: "linux", remote: true, terminal: "kitty", multiplexer: "tmux" })).toContain(
    "tmux may also block",
  )
  expect(clipboardSignals({ TERM_PROGRAM: "ghostty", SSH_TTY: "/dev/pts/1" }, "6.8.0").terminal).toBe("ghostty")
})

test("local scenarios keep the terse clipboard message", () => {
  expect(pasteMissHint({ platform: "win32" })).toBe("Clipboard has nothing pasteable")
  expect(SCENARIOS["linux-local"].pasteEmpty).toContain("xclip")
})

test("remote disabled note is terse and free of old pitches", () => {
  expect(REMOTE_PASTE_DISABLED).toContain("paste its path")
  expect(REMOTE_PASTE_DISABLED).toContain("text pastes normally")
  expect(REMOTE_PASTE_DISABLED).not.toContain("extension")
  expect(REMOTE_PASTE_DISABLED).not.toContain("paste-serve")
})
