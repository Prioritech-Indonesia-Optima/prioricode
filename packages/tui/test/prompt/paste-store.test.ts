import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PASTE_MAX_FILES, PASTE_TTL_MS, pasteDirectory, savePastedImage } from "../../src/component/prompt/paste-store"

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const PNG = Buffer.from(PNG_B64, "base64")

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "paste-store-test-"))
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 100))

test("pasteDirectory nests under the state dir", () => {
  expect(pasteDirectory("/home/dev/.local/share/prioricode")).toBe(
    path.join("/home/dev/.local/share/prioricode", "paste"),
  )
})

test("saved image round-trips and stays private (0600 in a 0700 dir)", async () => {
  const state = await tempDir()
  const directory = pasteDirectory(state)
  const file = await savePastedImage({ directory, mime: "image/png", base64: PNG_B64 })

  expect(file.startsWith(directory)).toBe(true)
  expect(file.endsWith(".png")).toBe(true)
  expect(await readFile(file)).toEqual(PNG)
  expect((await stat(file)).mode & 0o777).toBe(0o600)
  expect((await stat(directory)).mode & 0o777).toBe(0o700)
})

test("mime drives extension, unknown falls back to .bin", async () => {
  const state = await tempDir()
  const directory = pasteDirectory(state)
  const png = await savePastedImage({ directory, mime: "image/png", base64: PNG_B64, uuid: () => "u1" })
  const pdf = await savePastedImage({ directory, mime: "application/pdf", base64: PNG_B64, uuid: () => "u2" })
  const odd = await savePastedImage({ directory, mime: "image/heic", base64: PNG_B64, uuid: () => "u3" })
  expect(png.endsWith(".png")).toBe(true)
  expect(pdf.endsWith(".pdf")).toBe(true)
  expect(odd.endsWith(".bin")).toBe(true)
})

test("each paste lands as its own file", async () => {
  const state = await tempDir()
  const directory = pasteDirectory(state)
  const first = await savePastedImage({ directory, mime: "image/png", base64: PNG_B64, uuid: () => "aaaa1111" })
  const second = await savePastedImage({ directory, mime: "image/png", base64: PNG_B64, uuid: () => "bbbb2222" })
  expect(first).not.toBe(second)
  expect((await readdir(directory)).length).toBe(2)
})

test("empty payload rejects so callers keep their inline fallback", async () => {
  const state = await tempDir()
  const thrown = await savePastedImage({ directory: pasteDirectory(state), mime: "image/png", base64: "" }).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(thrown).toBeInstanceOf(Error)
})

test("save prunes entries past the TTL without touching fresh ones", async () => {
  const state = await tempDir()
  const directory = pasteDirectory(state)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const old = path.join(directory, "old.png")
  await writeFile(old, PNG, { mode: 0o600 })
  const ancient = new Date(Date.now() - PASTE_TTL_MS - 60_000)
  await utimes(old, ancient, ancient)

  const fresh = await savePastedImage({ directory, mime: "image/png", base64: PNG_B64 })
  await settled()

  expect(await stat(old).then(() => false, () => true)).toBe(true)
  expect(await readFile(fresh)).toEqual(PNG)
})

test("directory is capped by count, keeping the newest", async () => {
  const state = await tempDir()
  const directory = pasteDirectory(state)
  await savePastedImage({ directory, mime: "image/png", base64: PNG_B64 })
  for (let i = 0; i < PASTE_MAX_FILES; i++) {
    await writeFile(path.join(directory, `f-${String(i).padStart(3, "0")}.png`), PNG, { mode: 0o600 })
    const when = new Date(Date.now() - i * 10)
    await utimes(path.join(directory, `f-${String(i).padStart(3, "0")}.png`), when, when)
  }

  await savePastedImage({ directory, mime: "image/png", base64: PNG_B64 })
  await settled()

  const names = await readdir(directory)
  expect(names.length).toBe(PASTE_MAX_FILES)
  const survivors = new Set(names)
  // f-199 carries the oldest mtime stamp (now - 199*10ms); it is the one dropped.
  expect(survivors.has(`f-${String(PASTE_MAX_FILES - 1).padStart(3, "0")}.png`)).toBe(false)
  expect(survivors.has("f-000.png")).toBe(true)
})
