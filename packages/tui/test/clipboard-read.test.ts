import { expect, test } from "bun:test"
import {
  detectWsl,
  parseUriList,
  parseWindowsClipboardOutput,
  readClipboard,
  writeClipboard,
  type ClipboardEnvironment,
} from "../src/clipboard"

type Call = { command: string; args: readonly string[]; input?: string; timeoutMs?: number }

function fakeEnv(overrides: Partial<ClipboardEnvironment> & { platform: string }) {
  const calls: Call[] = []
  const files = new Map<string, Buffer>()
  const runners = new Map<string, (args: readonly string[], input?: string) => Promise<Buffer> | Buffer>()
  const env: ClipboardEnvironment = {
    wsl: false,
    tmp: "/tmp",
    has: () => false,
    read: async (file) => files.get(file) ?? Buffer.alloc(0),
    remove: async () => {},
    run: async (command, args = [], input, timeoutMs) => {
      calls.push({ command, args, input, timeoutMs })
      const runner = runners.get(command)
      if (!runner) throw new Error(`${command} missing`)
      const result = runner(args, input)
      return Buffer.isBuffer(result) ? result : await result
    },
    ...overrides,
  }
  return { env, calls, files, runners }
}

test("detectWsl covers WSL1, WSL2, and env markers", () => {
  expect(detectWsl("4.4.0-19041-Microsoft", {})).toBe(true)
  expect(detectWsl("5.15.153.1-microsoft-standard-WSL2", {})).toBe(true)
  expect(detectWsl("6.8.0-139-generic", { WSL_DISTRO_NAME: "Ubuntu" })).toBe(true)
  expect(detectWsl("6.8.0-139-generic", { WSL_INTEROP: "/run/WSL/12_interop" })).toBe(true)
  expect(detectWsl("6.8.0-139-generic (buildd@lcy02-amd64-036)", {})).toBe(false)
})

test("windows: native FFI image wins without touching the shell", async () => {
  const { env, calls } = fakeEnv({
    platform: "win32",
    win32: {
      readImage: () => ({ data: "QUJD", mime: "image/png" }),
      readDroppedFile: () => undefined,
      readText: () => undefined,
      writeText: () => true,
    },
  })
  expect(await readClipboard(env)).toEqual({ data: "QUJD", mime: "image/png" })
  expect(calls).toEqual([])
})

test("windows: copied image files attach through the path pipeline", async () => {
  const { env } = fakeEnv({
    platform: "win32",
    win32: {
      readImage: () => undefined,
      readDroppedFile: () => "C:\\shots\\screenshot.png",
      readText: () => undefined,
      writeText: () => true,
    },
  })
  expect(await readClipboard(env)).toEqual({ data: "C:\\shots\\screenshot.png", mime: "text/plain" })
})

test("windows: text then powershell fallback for bitmap-only clipboards", async () => {
  const powershell = fakeEnv({ platform: "win32" })
  powershell.runners.set("powershell.exe", () => Buffer.from("IMG YWJj\nZGVm\n"))
  expect(await readClipboard(powershell.env)).toEqual({ data: "YWJjZGVm", mime: "image/png" })
  expect(powershell.calls.find((call) => call.command === "powershell.exe")?.timeoutMs).toBe(6000)

  expect(parseWindowsClipboardOutput('DROP "C:\\shots\\a.png"\r\n')).toEqual({
    data: '"C:\\shots\\a.png"',
    mime: "text/plain",
  })

  const text = fakeEnv({ platform: "win32" })
  text.runners.set("powershell.exe", () => Buffer.from("TEXT halo dunia"))
  expect(await readClipboard(text.env)).toEqual({ data: "halo dunia", mime: "text/plain" })

  const empty = fakeEnv({ platform: "win32" })
  empty.runners.set("powershell.exe", () => Promise.reject(new Error("exit 1")))
  expect(await readClipboard(empty.env)).toBeUndefined()
})

test("wsl: reads the Windows clipboard through powershell interop", async () => {
  const wsl = fakeEnv({ platform: "linux", wsl: true })
  wsl.runners.set("powershell.exe", () => Buffer.from("IMG dGV4dA=="))
  expect(await readClipboard(wsl.env)).toEqual({ data: "dGV4dA==", mime: "image/png" })

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  )
  const nativeFirst = fakeEnv({ platform: "linux", wsl: true, has: (name) => name === "wl-paste" })
  nativeFirst.runners.set("wl-paste", (args) => (args.includes("-t") ? png : Buffer.from("hi")))
  expect(await readClipboard(nativeFirst.env)).toEqual({ data: png.toString("base64"), mime: "image/png" })
})

test("macos: PNGf first, then TIFF converted with built-in sips", async () => {
  const pngHit = fakeEnv({ platform: "darwin" })
  pngHit.runners.set("osascript", () => Buffer.alloc(0))
  pngHit.files.set("/tmp/prioricode-clipboard.png", Buffer.from("png-bytes"))
  expect(await readClipboard(pngHit.env)).toEqual({
    data: Buffer.from("png-bytes").toString("base64"),
    mime: "image/png",
  })
  expect(pngHit.calls.filter((call) => call.command === "sips")).toEqual([])

  const screenshot = fakeEnv({ platform: "darwin" })
  screenshot.runners.set("osascript", (args) => {
    if (args.includes('set imageData to the clipboard as "PNGf"')) return Promise.reject(new Error("-1700 conversion"))
    return Buffer.alloc(0)
  })
  screenshot.runners.set("sips", () => {
    screenshot.files.set("/tmp/prioricode-clipboard.png", Buffer.from("converted-png"))
    return Buffer.alloc(0)
  })
  expect(await readClipboard(screenshot.env)).toEqual({
    data: Buffer.from("converted-png").toString("base64"),
    mime: "image/png",
  })
  expect(screenshot.calls.some((call) => call.command === "sips" && call.args.includes("png"))).toBeTrue()

  const textOnly = fakeEnv({ platform: "darwin" })
  textOnly.runners.set("osascript", () => Promise.reject(new Error("no image")))
  textOnly.runners.set("pbpaste", () => Buffer.from("sometext"))
  expect(await readClipboard(textOnly.env)).toEqual({ data: "sometext", mime: "text/plain" })
})

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

test("linux: wl-clipboard then xclip images, then text from whichever tool exists", async () => {
  const x11 = fakeEnv({ platform: "linux", has: (name) => name === "xclip" })
  x11.runners.set("xclip", (args) => (args.includes("image/png") ? png : Promise.reject(new Error("no text"))))
  expect(await readClipboard(x11.env)).toEqual({ data: png.toString("base64"), mime: "image/png" })

  const text = fakeEnv({ platform: "linux", has: (name) => name === "xclip" })
  text.runners.set("xclip", (args) => (args.includes("image/png") ? Buffer.from("halo") : Buffer.from("halo")))
  expect(await readClipboard(text.env)).toEqual({ data: "halo", mime: "text/plain" })

  const bare = fakeEnv({ platform: "linux" })
  expect(await readClipboard(bare.env)).toBeUndefined()
})

test("write prefers native windows FFI, else native commands", async () => {
  const written: boolean[] = []
  const windows = fakeEnv({
    platform: "win32",
    win32: {
      readImage: () => undefined,
      readDroppedFile: () => undefined,
      readText: () => undefined,
      writeText: () => {
        written.push(true)
        return true
      },
    },
  })
  await writeClipboard(windows.env, "hello")
  expect(written).toEqual([true])
  expect(windows.calls).toEqual([])

  const powershell = fakeEnv({ platform: "win32" })
  powershell.runners.set("powershell.exe", () => Buffer.alloc(0))
  powershell.env = { ...powershell.env, has: (name) => name === "powershell.exe" }
  await writeClipboard(powershell.env, "hello")
  expect(powershell.calls[0]?.command).toBe("powershell.exe")
  expect(powershell.calls[0]?.input).toBe("hello")

  const wayland = fakeEnv({ platform: "linux", has: (name) => name === "wl-copy" })
  wayland.runners.set("wl-copy", () => Buffer.alloc(0))
  process.env.WAYLAND_DISPLAY = "wayland-test"
  try {
    await writeClipboard(wayland.env, "halo")
    expect(wayland.calls[0]?.input).toBe("halo")
  } finally {
    delete process.env.WAYLAND_DISPLAY
  }
})

test("linux: copied image files attach through uri-list targets", async () => {
  const x11 = fakeEnv({ platform: "linux", has: (name) => name === "xclip" })
  x11.runners.set("xclip", (args) => {
    if (args.includes("image/png")) return Promise.reject(new Error("Target image/png does not exist"))
    if (args.includes("text/uri-list")) return Buffer.from("file:///home/u/work/app/image.png\r\n")
    return Promise.reject(new Error("no text"))
  })
  expect(await readClipboard(x11.env)).toEqual({
    data: "file:///home/u/work/app/image.png",
    mime: "text/plain",
  })

  const gnome = fakeEnv({ platform: "linux", has: (name) => name === "wl-paste" })
  gnome.runners.set("wl-paste", (args) => {
    if (args.includes("image/png")) return Promise.reject(new Error("target unavailable"))
    if (args.includes("text/uri-list")) return Promise.reject(new Error("target unavailable"))
    if (args.includes("x-special/gnome-copied-files")) return Buffer.from("copy\nfile:///home/u/Pictures/shot.png\n")
    return Promise.reject(new Error("no text"))
  })
  expect(await readClipboard(gnome.env)).toEqual({
    data: "file:///home/u/Pictures/shot.png",
    mime: "text/plain",
  })

  const imageFirst = fakeEnv({ platform: "linux", has: (name) => name === "wl-paste" })
  imageFirst.runners.set("wl-paste", (args) =>
    args.includes("image/png") ? png : Buffer.from("file:///home/u/work/app/image.png"),
  )
  expect(await readClipboard(imageFirst.env)).toEqual({ data: png.toString("base64"), mime: "image/png" })

  const remoteOnly = fakeEnv({ platform: "linux", has: (name) => name === "xclip" })
  remoteOnly.runners.set("xclip", (args) =>
    args.includes("image/png") || args.includes("uri-list") || args.includes("gnome-copied-files")
      ? Buffer.from("https://example.com/a.png")
      : Buffer.from("halo"),
  )
  expect(await readClipboard(remoteOnly.env)).toEqual({ data: "halo", mime: "text/plain" })
})

test("parseUriList: skips comments and non-file entries", () => {
  expect(parseUriList("# comment\r\nfile:///home/u/a%20b.png\r\nfile:///other")).toBe("file:///home/u/a%20b.png")
  expect(parseUriList("copy\nfile:///home/u/Pictures/shot.png")).toBe("file:///home/u/Pictures/shot.png")
  expect(parseUriList("https://example.com/a.png")).toBeUndefined()
  expect(parseUriList("")).toBeUndefined()
})

test("macos: Finder file copies surface the dropped path as a file URL", async () => {
  const finder = fakeEnv({ platform: "darwin" })
  finder.runners.set("osascript", (args) => {
    if (args.some((arg) => arg.includes("clipboard info"))) return Buffer.from("/Users/me/Pictures/shot.png\n")
    return Promise.reject(new Error("no image"))
  })
  finder.runners.set("pbpaste", () => Promise.reject(new Error("no text")))
  expect(await readClipboard(finder.env)).toEqual({
    data: "file:///Users/me/Pictures/shot.png",
    mime: "text/plain",
  })

  const textOnly = fakeEnv({ platform: "darwin" })
  textOnly.runners.set("osascript", (args) =>
    args.some((arg) => arg.includes("clipboard info"))
      ? Promise.reject(new Error("no file"))
      : Promise.reject(new Error("no image")),
  )
  textOnly.runners.set("pbpaste", () => Buffer.from("sometext"))
  expect(await readClipboard(textOnly.env)).toEqual({ data: "sometext", mime: "text/plain" })
})
