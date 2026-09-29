import { spawn } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import { platform, release, tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { createWin32Clipboard, type Win32Clipboard } from "./clipboard-win32"

export type Content = Readonly<{ data: string; mime: string }>

export type ClipboardEnvironment = Readonly<{
  platform: string
  wsl: boolean
  tmp: string
  run(command: string, args?: readonly string[], input?: string, timeoutMs?: number): Promise<Buffer>
  has(name: string): boolean
  read(file: string): Promise<Buffer>
  remove(file: string): Promise<void>
  win32?: Win32Clipboard
}>

function command(command: string, args: readonly string[] = [], input?: string, timeoutMs = 3000) {
  return new Promise<Buffer>((resolve, reject) => {
    // Write calls pipe stdin but must not hold a stdout pipe: clipboard owners
    // (xclip/wl-copy daemons) inherit it and keep it open while serving the
    // selection, which would delay `close` until the kill timer.
    const child = spawn(command, Array.from(args), {
      stdio: [input === undefined ? "ignore" : "pipe", input === undefined ? "pipe" : "ignore", "ignore"],
    })
    const output: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk))
    child.on("close", (code) => {
      clearTimeout(timer)
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

export const WINDOWS_CLIPBOARD_SCRIPT =
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
  "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " +
  "try { " +
  "$img = [System.Windows.Forms.Clipboard]::GetImage(); " +
  "if ($img) { " +
  "$ms = New-Object System.IO.MemoryStream; " +
  "$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); " +
  'Write-Output ("IMG " + [System.Convert]::ToBase64String($ms.ToArray())); exit 0 } ' +
  "$files = [System.Windows.Forms.Clipboard]::GetFileDrop(); " +
  'if ($files -and $files.Length -gt 0) { Write-Output ("DROP " + $files[0].FullName); exit 0 } ' +
  "$text = [System.Windows.Forms.Clipboard]::GetText(); " +
  'if ($text) { Write-Output ("TEXT " + $text) } ' +
  "} catch { exit 1 }"

export function parseWindowsClipboardOutput(output: string): Content | undefined {
  const text = output.trim()
  if (text.startsWith("IMG ")) return { data: text.slice(4).replace(/\s+/g, ""), mime: "image/png" }
  if (text.startsWith("DROP ")) return { data: text.slice(5).trim(), mime: "text/plain" }
  if (text.startsWith("TEXT ")) return { data: text.slice(5), mime: "text/plain" }
}

function osascriptClipboard(file: string, type: string) {
  return [
    "-e",
    `set imageData to the clipboard as "${type}"`,
    "-e",
    `set fileRef to open for access POSIX file "${file}" with write permission`,
    "-e",
    "set eof fileRef to 0",
    "-e",
    "write imageData to fileRef",
    "-e",
    "close access fileRef",
  ]
}

// File managers copy files as URI lists, not image bytes. Return the first
// local file so the prompt pipeline can attach it like a dropped path.
export function parseUriList(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim()
    if (!entry || entry.startsWith("#")) continue
    if (entry.startsWith("file://")) return entry
  }
}

async function readDarwin(env: ClipboardEnvironment): Promise<Content | undefined> {
  const png = path.join(env.tmp, "prioricode-clipboard.png")
  const tiff = path.join(env.tmp, "prioricode-clipboard.tiff")
  try {
    // Screenshots land on the macOS clipboard as TIFF, so a plain "PNGf" read
    // must fall back to TIFF with a built-in (sips) conversion.
    for (const attempt of [
      { type: "PNGf", convert: false },
      { type: "TIFF", convert: true },
    ]) {
      try {
        await env.run("osascript", osascriptClipboard(attempt.convert ? tiff : png, attempt.type), undefined, 8000)
        if (attempt.convert) await env.run("sips", ["-s", "format", "png", tiff, "--out", png], undefined, 8000)
        const data = await env.read(png)
        if (data.length) return { data: data.toString("base64"), mime: "image/png" }
      } catch {
        // Try the next clipboard representation.
      }
    }
  } finally {
    await env.remove(png).catch(() => {})
    await env.remove(tiff).catch(() => {})
  }
  // Finder copies put a file reference («class:furl») on the pasteboard, not
  // image data; surface the first copied file's path for the attach pipeline.
  const dropped = await env
    .run(
      "osascript",
      [
        "-e",
        'if ((clipboard info) as text) contains "class furl" then',
        "-e",
        "POSIX path of (the clipboard as \u00abclass:furl\u00bb)",
        "-e",
        'else error "no file"',
        "-e",
        "end if",
      ],
      undefined,
      6000,
    )
    .catch(() => Buffer.alloc(0))
  const file = dropped.toString().trim()
  if (file) return { data: pathToFileURL(file).href, mime: "text/plain" }
  const text = await env.run("pbpaste", [], undefined, 6000).catch(() => Buffer.alloc(0))
  if (text.length) return { data: text.toString(), mime: "text/plain" }
}

async function readPowershell(env: ClipboardEnvironment): Promise<Content | undefined> {
  const output = await env
    .run("powershell.exe", ["-NonInteractive", "-NoProfile", "-command", WINDOWS_CLIPBOARD_SCRIPT], undefined, 15000)
    .catch(() => Buffer.alloc(0))
  return parseWindowsClipboardOutput(output.toString())
}

async function readWindows(env: ClipboardEnvironment): Promise<Content | undefined> {
  const image = env.win32?.readImage()
  if (image) return { data: image.data, mime: image.mime }
  const dropped = env.win32?.readDroppedFile()
  if (dropped) return { data: dropped, mime: "text/plain" }
  const text = env.win32?.readText()
  if (text) return { data: text, mime: "text/plain" }
  // PowerShell stays as fallback: it also covers bitmap-only clipboards
  // (CF_BITMAP without CF_DIB) which need GDI conversion we do not do in FFI.
  return readPowershell(env)
}

// Clipboard owners answer a `-t image/png` request with whatever they hold, so
// raw bytes must still prove they are a real image before we treat them as one.
export function sniffImageMime(bytes: Buffer): string | undefined {
  if (bytes.length < 12) return
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes.toString("latin1", 12, 16) === "IHDR"
  )
    return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  const head = bytes.toString("latin1", 0, 10)
  if (head === "GIF87a" || head === "GIF89a") return "image/gif"
  if (head.startsWith("RIFF") && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp"
  if (bytes.toString("latin1", 4, 12) === "ftypavif") return "image/avif"
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp"
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 0x2a)
  )
    return "image/tiff"
}

function imageData(bytes: Buffer): Content | undefined {
  const mime = sniffImageMime(bytes)
  if (!mime) return
  return { data: bytes.toString("base64"), mime }
}

async function readLinux(env: ClipboardEnvironment): Promise<Content | undefined> {
  if (env.has("wl-paste")) {
    const image = await env.run("wl-paste", ["-t", "image/png"]).catch(() => Buffer.alloc(0))
    const sniffed = imageData(image)
    if (sniffed) return sniffed
  }
  if (env.has("xclip")) {
    const image = await env
      .run("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"])
      .catch(() => Buffer.alloc(0))
    const sniffed = imageData(image)
    if (sniffed) return sniffed
  }
  // File managers (Nautilus, Dolphin, Thunar, ...) copy files as URI lists, so
  // a copied screenshot has no image/png target at all. Surface the first
  // copied file for the attach pipeline before falling back to plain text.
  for (const target of ["text/uri-list", "x-special/gnome-copied-files"]) {
    if (env.has("wl-paste")) {
      const uris = await env.run("wl-paste", ["-t", target]).catch(() => Buffer.alloc(0))
      const dropped = parseUriList(uris.toString())
      if (dropped) return { data: dropped, mime: "text/plain" }
    }
    if (env.has("xclip")) {
      const uris = await env.run("xclip", ["-selection", "clipboard", "-t", target, "-o"]).catch(() => Buffer.alloc(0))
      const dropped = parseUriList(uris.toString())
      if (dropped) return { data: dropped, mime: "text/plain" }
    }
  }
  for (const [name, args] of [
    ["wl-paste", []],
    ["xclip", ["-selection", "clipboard", "-o"]],
    ["xsel", ["--clipboard", "--output"]],
  ] as const) {
    if (!env.has(name)) continue
    const text = await env.run(name, args).catch(() => Buffer.alloc(0))
    if (text.length) return { data: text.toString(), mime: "text/plain" }
  }
}

export async function readClipboard(env: ClipboardEnvironment): Promise<Content | undefined> {
  if (env.platform === "darwin") return readDarwin(env)
  if (env.platform === "win32") return readWindows(env)
  const local = await readLinux(env)
  if (local) return local
  if (env.wsl) return readPowershell(env)
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
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
    ]
  }
}

export async function writeClipboard(env: ClipboardEnvironment, text: string) {
  if (env.platform === "win32" && env.win32?.writeText(text)) return
  const os = env.platform as NodeJS.Platform
  const native = copyCommand(os, Boolean(process.env.WAYLAND_DISPLAY), env.has)
  if (native?.[0] === "osascript") {
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    await env.run("osascript", ["-e", `set the clipboard to "${escaped}"`], undefined, 8000).catch(() => undefined)
    return
  }
  if (native) {
    await env.run(native[0]!, native.slice(1), text, 8000).catch(() => undefined)
    return
  }
  if (env.platform === "win32" || env.wsl) {
    await env
      .run(
        "powershell.exe",
        ["-NonInteractive", "-NoProfile", "-command", `Set-Clipboard -Value ([Console]::In.ReadToEnd())`],
        text,
        15000,
      )
      .catch(() => undefined)
  }
}

let live: Promise<ClipboardEnvironment> | undefined

function liveEnvironment() {
  return (live ??= (async () => {
    const { which } = await import("@prioricode/core/util/which")
    const windows = platform() === "win32" ? createWin32Clipboard() : undefined
    const env: ClipboardEnvironment = {
      platform: platform(),
      wsl: release().includes("WSL"),
      tmp: tmpdir(),
      run: command,
      has: (name) => Boolean(which(name)),
      read: (file) => readFile(file),
      remove: (file) => rm(file, { force: true }),
      win32: windows,
    }
    return env
  })())
}

export async function read() {
  return readClipboard(await liveEnvironment())
}

export async function write(text: string) {
  writeOsc52(text)
  const env = await liveEnvironment()
  await writeClipboard(env, text)
}
