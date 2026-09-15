import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clipboardImageHint, clipboardInstallPlan, copyCommand } from "../src/clipboard"

const NO_TOOLS = "/nonexistent-prioricode-test-path"

test("prefers Wayland clipboard when available", () => {
  expect(copyCommand("linux", true, (name) => name === "wl-copy")).toEqual(["wl-copy"])
})

test("uses osascript on macOS", () => {
  expect(copyCommand("darwin", false, (name) => name === "osascript")).toEqual(["osascript"])
})

test("falls back through X11 clipboard commands", () => {
  expect(copyCommand("linux", true, (name) => name === "xclip")).toEqual(["xclip", "-selection", "clipboard"])
  expect(copyCommand("linux", false, (name) => name === "xsel")).toEqual(["xsel", "--clipboard", "--input"])
})

test("returns undefined when native clipboard is unavailable", () => {
  expect(copyCommand("linux", false, () => false)).toBeUndefined()
})

test("plans apt-get install of wl-clipboard on Ubuntu under Wayland", () => {
  const plan = clipboardInstallPlan(
    { PATH: NO_TOOLS, WAYLAND_DISPLAY: "wayland-0" },
    'ID=ubuntu\nID_LIKE="debian"\n',
  )
  expect(plan).toEqual({ command: "sudo", args: ["apt-get", "install", "-y", "wl-clipboard"], packages: ["wl-clipboard"] })
})

test("plans pacman install of xclip on Arch without Wayland", () => {
  const plan = clipboardInstallPlan({ PATH: NO_TOOLS }, "ID=arch\n")
  expect(plan).toEqual({ command: "sudo", args: ["pacman", "-S", "--noconfirm", "xclip"], packages: ["xclip"] })
})

test("matches distro via ID_LIKE for Fedora-family", () => {
  const plan = clipboardInstallPlan({ PATH: NO_TOOLS }, 'ID=linuxmint\nID_LIKE="ubuntu debian"\n')
  expect(plan?.args).toEqual(["apt-get", "install", "-y", "xclip"])
})

test("returns no plan for an unrecognized distro", () => {
  expect(clipboardInstallPlan({ PATH: NO_TOOLS }, "ID=gentoo\n")).toBeUndefined()
})

test("returns no plan when a clipboard backend is already present", () => {
  const dir = join(tmpdir(), `prioricode-clip-test-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  const stub = join(dir, "wl-paste")
  writeFileSync(stub, "#!/bin/sh\nexit 0\n")
  chmodSync(stub, 0o755)
  try {
    expect(clipboardInstallPlan({ PATH: dir, WAYLAND_DISPLAY: "wayland-0" }, "ID=ubuntu\n")).toBeUndefined()
    expect(clipboardImageHint({ PATH: dir, WAYLAND_DISPLAY: "wayland-0" })).toBeUndefined()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("image hint points at the in-app install command when no backend exists", () => {
  expect(clipboardImageHint({ PATH: NO_TOOLS, WAYLAND_DISPLAY: "wayland-0" })).toContain("Install clipboard support")
})
