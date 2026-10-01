// Clipboard image reads on the machine VS Code (and this extension host) runs
// on. The stable extension API only exposes clipboard text, so images go
// through the same OS tools the TUI uses: PowerShell on Windows, osascript/sips
// on macOS, wl-clipboard/xclip on Linux.
import { execFile, spawn } from "child_process"
import { tmpdir } from "os"
import { readFile, rm } from "fs/promises"
import { join } from "path"

export type ClipboardImage = Readonly<{ mime: string; data: string }>

const IMAGE_MIME_SCRIPT =
  "[Console]::OutputEncoding = [System.Text.Encoding]::ASCII; " +
  "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " +
  "try { $img = [System.Windows.Forms.Clipboard]::GetImage(); " +
  "if ($img) { $ms = New-Object System.IO.MemoryStream; " +
  "$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); " +
  "[System.Convert]::ToBase64String($ms.ToArray()) } } catch {}"

function run(command: string, args: string[], timeoutMs = 8000): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "buffer", maxBuffer: 24 * 1024 * 1024, timeout: timeoutMs }, (error, stdout) => {
      resolve(error ? undefined : stdout)
    })
  })
}

export function sniffImageMime(bytes: Buffer): string | undefined {
  if (bytes.length < 12) return
  if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG" && bytes.toString("latin1", 12, 16) === "IHDR")
    return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  const head = bytes.toString("latin1", 0, 10)
  if (head === "GIF87a" || head === "GIF89a") return "image/gif"
  if (head.startsWith("RIFF") && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp"
}

function base64Image(stdout: Buffer | undefined): ClipboardImage | undefined {
  const text = (stdout?.toString("utf8") ?? "").replace(/\s+/g, "")
  if (!text) return
  const bytes = Buffer.from(text, "base64")
  const mime = sniffImageMime(bytes)
  if (!mime) return
  return { mime, data: bytes.toString("base64") }
}

async function readWindows(): Promise<ClipboardImage | undefined> {
  return base64Image(await run("powershell.exe", ["-NonInteractive", "-NoProfile", "-Command", IMAGE_MIME_SCRIPT], 10000))
}

function osascriptClipboard(file: string, type: string): string[] {
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

// Screenshots land on the macOS pasteboard as TIFF, so PNGf needs a sips
// fallback, mirroring packages/tui/src/clipboard.ts readDarwin.
async function readDarwin(): Promise<ClipboardImage | undefined> {
  const png = join(tmpdir(), "prioricode-vscode-clipboard.png")
  const tiff = join(tmpdir(), "prioricode-vscode-clipboard.tiff")
  try {
    for (const attempt of [
      { type: "PNGf", convert: false },
      { type: "TIFF", convert: true },
    ]) {
      try {
        const steps = attempt.convert
          ? [
              await run("osascript", osascriptClipboard(tiff, attempt.type)),
              await run("sips", ["-s", "format", "png", tiff, "--out", png]),
            ]
          : [await run("osascript", osascriptClipboard(png, attempt.type))]
        if (steps.some((step) => step === undefined)) continue
        const bytes = await readFile(png)
        const mime = sniffImageMime(bytes)
        if (mime) return { mime, data: bytes.toString("base64") }
      } catch {}
    }
  } finally {
    void rm(png, { force: true }).catch(() => {})
    void rm(tiff, { force: true }).catch(() => {})
  }
}

async function runBinary(command: string, args: string[]): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] })
    const chunks: Buffer[] = []
    let bytes = 0
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve(undefined)
    }, 6000)
    timer.unref?.()
    child.on("error", () => {
      clearTimeout(timer)
      resolve(undefined)
    })
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 24 * 1024 * 1024) {
        child.kill("SIGKILL")
        resolve(undefined)
        return
      }
      chunks.push(chunk)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? Buffer.concat(chunks) : undefined)
    })
  })
}

async function readLinux(): Promise<ClipboardImage | undefined> {
  const attempts = [
    ["wl-paste", ["-t", "image/png"]],
    ["xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]],
  ] as const
  for (const [command, args] of attempts) {
    const bytes = await runBinary(command, args.slice() as string[])
    if (!bytes?.length) continue
    const mime = sniffImageMime(bytes)
    if (mime) return { mime, data: bytes.toString("base64") }
  }
}

export async function readClipboardImage(): Promise<ClipboardImage | undefined> {
  if (process.platform === "win32") return readWindows()
  if (process.platform === "darwin") return readDarwin()
  if (process.platform === "linux") return readLinux()
}
