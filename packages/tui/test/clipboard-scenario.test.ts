import { expect, test } from "bun:test"
import { clipboardSignals, pasteMissHint, resolveScenario, SCENARIOS } from "../src/clipboard-scenario"

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
  expect(message).toContain("Images cannot cross SSH")
  expect(message).toContain("scp")
  expect(SCENARIOS["linux-remote"].copyOsc52).toContain("OSC 52")
})

test("local scenarios keep the terse clipboard message", () => {
  expect(pasteMissHint({ platform: "win32" })).toBe("Clipboard has nothing pasteable")
  expect(SCENARIOS["linux-local"].pasteEmpty).toContain("xclip")
})
