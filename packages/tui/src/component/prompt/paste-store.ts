// Clipboard image landing: every delivered image becomes a real file in a
// private per-user directory, and the prompt attachment references that path.
// This makes paste behave identically for local host reads, remote terminal
// protocol (OSC 5522), and companion uploads (VS Code extension → /tui/attach):
// bytes arrive → land on disk → are attached by path (plus inline content so
// the model payload needs no second read). The state dir is private (0700) —
// never a world-readable /tmp.
import { randomUUID } from "node:crypto"
import { chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

export const PASTE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PASTE_MAX_FILES = 200

const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/tiff": ".tif",
  "application/pdf": ".pdf",
}

export function pasteDirectory(state: string): string {
  return path.join(state, "paste")
}

export async function savePastedImage(input: Readonly<{
  directory: string
  mime: string
  base64: string
  now?: () => number
  uuid?: () => string
}>): Promise<string> {
  const bytes = Buffer.from(input.base64, "base64")
  if (!bytes.length) throw new Error("paste store: empty image payload")
  await mkdir(input.directory, { recursive: true, mode: 0o700 })
  // mkdir applies the umask and leaves pre-existing directories untouched;
  // chmod guarantees 0700 either way.
  await chmod(input.directory, 0o700)
  const id = (input.uuid?.() ?? randomUUID()).replace(/-/g, "").slice(0, 12)
  const file = path.join(input.directory, `clipboard-${id}${EXTENSIONS[input.mime] ?? ".bin"}`)
  await writeFile(file, bytes, { mode: 0o600 })
  await chmod(file, 0o600)
  prune(input.directory, input.now?.() ?? Date.now()).catch(() => {})
  return file
}

// Opportunistic hygiene on every save: drop entries older than the TTL, then
// cap the directory by mtime. Failures are invisible to the paste itself.
async function prune(directory: string, now: number): Promise<void> {
  const entries = await readdir(directory)
  const seen: { name: string; mtimeMs: number }[] = []
  for (const name of entries) {
    const file = path.join(directory, name)
    try {
      const info = await stat(file)
      if (now - info.mtimeMs > PASTE_TTL_MS) {
        await rm(file, { force: true })
        continue
      }
      seen.push({ name, mtimeMs: info.mtimeMs })
    } catch {
      // vanished or unreadable entry: nothing to clean
    }
  }
  if (seen.length <= PASTE_MAX_FILES) return
  seen.sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const entry of seen.slice(0, seen.length - PASTE_MAX_FILES)) {
    await rm(path.join(directory, entry.name), { force: true }).catch(() => {})
  }
}

