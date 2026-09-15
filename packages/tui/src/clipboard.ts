import { execFile, spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { platform, release, tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { which } from "@prioricode/core/util/which"

const exec = promisify(execFile)

function command(command: string, args: string[] = [], input?: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"] })
    const output: Buffer[] = []
    child.on("error", reject)
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk))
    child.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(output))
      reject(new Error(`${command} exited with code ${code}`))
    })
    if (input !== undefined) child.stdin?.end(input)
  })
}

function writeOsc52(text: string) {
  if (!process.stdout.isTTY) return
  const sequence = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`
  const passthrough = `\x1bPtmux;\x1b${sequence}\x1b\\`
  process.stdout.write(process.env.TMUX ? sequence + passthrough : process.env.STY ? passthrough : sequence)
}

export async function read() {
  if (platform() === "darwin") {
    const file = path.join(tmpdir(), "prioricode-clipboard.png")
    try {
      await exec("osascript", [
        "-e",
        'set imageData to the clipboard as "PNGf"',
        "-e",
        `set fileRef to open for access POSIX file "${file}" with write permission`,
        "-e",
        "set eof fileRef to 0",
        "-e",
        "write imageData to fileRef",
        "-e",
        "close access fileRef",
      ])
      return { data: (await readFile(file)).toString("base64"), mime: "image/png" }
    } catch {
      // Fall through to text clipboard.
    } finally {
      await rm(file, { force: true }).catch(() => {})
    }
  }

  if (platform() === "win32" || release().includes("WSL")) {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }"
    const image = await command("powershell.exe", ["-NonInteractive", "-NoProfile", "-command", script]).catch(() =>
      Buffer.alloc(0),
    )
    if (image.length) return { data: image.toString().trim(), mime: "image/png" }
  }

  if (platform() === "linux") {
    const wayland = await command("wl-paste", ["-t", "image/png"]).catch(() => Buffer.alloc(0))
    if (wayland.length) return { data: wayland.toString("base64"), mime: "image/png" }
    const x11 = await command("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]).catch(() =>
      Buffer.alloc(0),
    )
    if (x11.length) return { data: x11.toString("base64"), mime: "image/png" }
  }

  const { default: clipboardy } = await import("clipboardy")
  const text = await clipboardy.read().catch(() => undefined)
  if (text) return { data: text, mime: "text/plain" }
}

/**
 * On a pure Linux desktop, image paste depends on an external clipboard tool
 * (`wl-paste` for Wayland, `xclip`/`xsel` for X11) that ships with the distro,
 * not with this binary. When none is present, `read()` silently yields nothing
 * for image-only clipboards. This returns an actionable install hint so callers
 * can surface the gap instead of failing silently. Returns `undefined` when a
 * backend exists or the platform reads the clipboard through system tools
 * (macOS `osascript`, Windows/WSL PowerShell).
 */
export function clipboardImageHint(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (platform() !== "linux") return undefined
  if (release().includes("WSL")) return undefined
  if (which("wl-paste", env) || which("xclip", env) || which("xsel", env)) return undefined
  if (clipboardInstallPlan(env))
    return "Image paste needs a clipboard tool. Run 'Install clipboard support' from the command palette, or drag an image file into the prompt."
  const pkg = env.WAYLAND_DISPLAY ? "wl-clipboard" : "xclip"
  return `Image paste needs a clipboard tool. Install ${pkg} with your package manager, or drag an image file into the prompt.`
}

export type ClipboardInstallPlan = Readonly<{ command: string; args: string[]; packages: string[] }>

/** Minimal terminal handoff surface so this stays testable and free of @opentui imports. */
export interface TerminalOwner {
  suspend(): void
  resume(): void
  requestRender(): void
  currentRenderBuffer: { clear(): void }
}

export type ClipboardInstallResult = Readonly<{ ok: boolean; message: string }>

function packageManager(id: string, like: string[]): { command: string; args: string[] } | undefined {
  const tokens = new Set([id, ...like])
  if (tokens.has("ubuntu") || tokens.has("debian")) return { command: "apt-get", args: ["install", "-y"] }
  if (tokens.has("fedora") || tokens.has("rhel") || tokens.has("centos")) return { command: "dnf", args: ["install", "-y"] }
  if (tokens.has("arch") || tokens.has("manjaro")) return { command: "pacman", args: ["-S", "--noconfirm"] }
  if (tokens.has("suse") || tokens.has("sles") || tokens.has("opensuse")) return { command: "zypper", args: ["install", "-y"] }
  if (tokens.has("alpine")) return { command: "apk", args: ["add"] }
  return undefined
}

function parseOsRelease(text: string) {
  const fields: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const match = /^(ID|ID_LIKE)=(.*)$/.exec(line)
    if (match) fields[match[1]!] = match[2]!.replace(/"/g, "").trim()
  }
  return { id: (fields.ID ?? "").toLowerCase(), like: (fields.ID_LIKE ?? "").toLowerCase().split(/\s+/).filter(Boolean) }
}

/**
 * Detects a concrete, distro-appropriate command to install the missing Linux
 * clipboard helper, so the app can take care of it instead of telling the user
 * to figure out which package manager and package they need. Returns
 * `undefined` when a backend already exists, the platform reads the clipboard
 * through system tools (macOS/Windows), or no supported package manager is
 * recognized. `osRelease` is injectable for testing.
 */
export function clipboardInstallPlan(
  env: NodeJS.ProcessEnv = process.env,
  osRelease?: string,
): ClipboardInstallPlan | undefined {
  if (platform() !== "linux" || release().includes("WSL")) return undefined
  if (which("wl-paste", env) || which("xclip", env) || which("xsel", env)) return undefined
  let text = osRelease
  if (text === undefined) {
    try {
      text = readFileSync("/etc/os-release", "utf8")
    } catch {
      return undefined
    }
  }
  const { id, like } = parseOsRelease(text)
  const manager = packageManager(id, like)
  if (!manager) return undefined
  const packages = [env.WAYLAND_DISPLAY ? "wl-clipboard" : "xclip"]
  return { command: "sudo", args: [manager.command, ...manager.args, ...packages], packages }
}

/**
 * Runs the detected install command with the terminal handed to the child so
 * `sudo` can prompt for a password and package output streams to the user,
 * then restores the TUI. Mirrors the external-editor handoff in editor.ts.
 */
export async function installClipboardSupport(
  terminal: TerminalOwner,
  env: NodeJS.ProcessEnv = process.env,
  osRelease?: string,
): Promise<ClipboardInstallResult> {
  const plan = clipboardInstallPlan(env, osRelease)
  if (!plan) return { ok: false, message: "No supported package manager found. Install a clipboard tool manually." }
  terminal.suspend()
  terminal.currentRenderBuffer.clear()
  try {
    const code = await new Promise<number>((resolve) => {
      const child = spawn(plan.command, plan.args, { stdio: "inherit" })
      child.on("error", () => resolve(-1))
      child.on("exit", (exitCode) => resolve(exitCode ?? -1))
    })
    if (code === 0) return { ok: true, message: `Installed ${plan.packages.join(", ")}. Image paste is ready.` }
    return { ok: false, message: `Clipboard install failed (${plan.command} exited ${code}). Try installing ${plan.packages.join(" or ")} manually.` }
  } finally {
    terminal.currentRenderBuffer.clear()
    terminal.resume()
    terminal.requestRender()
  }
}

export function copyCommand(
  os: NodeJS.Platform,
  wayland: boolean,
  has: (name: string) => boolean,
): string[] | undefined {
  if (os === "darwin" && has("osascript")) return ["osascript"]
  if (os === "linux" && wayland && has("wl-copy")) return ["wl-copy"]
  if (os === "linux" && has("xclip")) return ["xclip", "-selection", "clipboard"]
  if (os === "linux" && has("xsel")) return ["xsel", "--clipboard", "--input"]
  if (os === "win32" && has("powershell.exe")) {
    return [
      "powershell.exe",
      "-NonInteractive",
      "-NoProfile",
      "-Command",
      "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
    ]
  }
}

let copyMethod: Promise<(text: string) => Promise<void>> | undefined

function getCopyMethod() {
  return (copyMethod ??= (async () => {
    const { which } = await import("@prioricode/core/util/which")
    const native = copyCommand(platform(), Boolean(process.env.WAYLAND_DISPLAY), (name) => Boolean(which(name)))
    if (native?.[0] === "osascript") {
      return async (text: string) => {
        const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        await command("osascript", ["-e", `set the clipboard to "${escaped}"`]).catch(() => undefined)
      }
    }
    if (native) {
      return async (text: string) => {
        await command(native[0], native.slice(1), text).catch(() => undefined)
      }
    }
    return async (text: string) => {
      const { default: clipboardy } = await import("clipboardy")
      await clipboardy.write(text).catch(() => undefined)
    }
  })())
}

export async function write(text: string) {
  writeOsc52(text)
  const method = await getCopyMethod()
  await method(text)
}
