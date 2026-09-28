/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

const TAGLINE = "the open source AI coding agent"

async function harness(width: number) {
  const rootDir = await tmpdir()
  const root = rootDir.path
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [{ HomeHero }, { KVProvider }, { ThemeProvider }, { TuiConfigProvider }] = await Promise.all([
    import("../../src/component/home-hero"),
    import("../../src/context/kv"),
    import("../../src/context/theme"),
    import("../../src/config"),
  ])

  function Wrapper() {
    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <TuiConfigProvider config={createTuiResolvedConfig({})}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <HomeHero />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Wrapper />, { width, height: 12 })
  return { app, cleanup: () => rootDir[Symbol.asyncDispose]() }
}

// Regression for the v0.1.11 startup crash: opentui's setProperty intercepts
// the "text" attribute for every renderable and stringifies the value, so the
// old `text={theme.text}` prop fed a string into the painter's RGBA.toInts and
// killed the home route on mount. Painter-only tests over a mock buffer never
// exercise that path — mounting through the real renderer does.
test("home hero mounts through the real renderer and paints the block wordmark", async () => {
  const { app, cleanup } = await harness(100)
  try {
    let frame = ""
    for (let i = 0; i < 120; i++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("█") && frame.includes(TAGLINE)) break
      await Bun.sleep(25)
    }
    expect(frame).toContain("█")
    expect(frame).toContain(TAGLINE)
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})

// The painter must survive stringified theme values (exactly what the solid
// renderer's setProperty produces for intercepted prop names like "text"):
// reject them and keep the previous palette instead of throwing on mount.
test("painter setTheme rejects non-RGBA values without throwing", async () => {
  const { HomeHeroPainter } = await import("../../src/component/home-hero-render")
  const { RGBA } = await import("@opentui/core")
  const painter = new HomeHeroPainter()
  expect(
    painter.setTheme({
      background: RGBA.fromInts(10, 10, 12),
      primary: RGBA.fromInts(216, 166, 58),
      text: RGBA.fromInts(232, 230, 223),
      textMuted: RGBA.fromInts(107, 107, 118),
    }),
  ).toBe(true)
  expect(painter.setTheme({ text: "[object Object]" as never })).toBe(false)
  expect(painter.setTheme({ textMuted: undefined })).toBe(false)
})

function mockBuffer(w: number, h: number) {
  const cells = w * h
  return {
    width: w,
    height: h,
    buffers: {
      char: new Uint32Array(cells).fill(32),
      fg: new Uint16Array(cells * 4),
      bg: new Uint16Array(cells * 4),
      attributes: new Uint32Array(cells),
    },
  } as unknown as import("@opentui/core").OptimizedBuffer
}

function channelDelta(a: [number, number, number], r: number, g: number, b: number) {
  return Math.max(Math.abs(a[0] - r), Math.abs(a[1] - g), Math.abs(a[2] - b))
}

// Drive a painter deterministically to a fixed elapsed time (25ms steps).
function drive(
  painter: InstanceType<typeof import("../../src/component/home-hero-render").HomeHeroPainter>,
  buffer: ReturnType<typeof mockBuffer>,
  to: number,
) {
  let t = 0
  while (t < to) {
    painter.render(buffer, { deltaTime: 25 })
    t += 25
  }
  return buffer
}

async function lightPainter(to: number) {
  const { HomeHeroPainter, HERO_W, HERO_H } = await import("../../src/component/home-hero-render")
  const { RGBA } = await import("@opentui/core")
  const painter = new HomeHeroPainter()
  painter.setTheme({
    background: RGBA.fromInts(245, 245, 242),
    primary: RGBA.fromInts(176, 133, 31),
    text: RGBA.fromInts(45, 44, 44),
    textMuted: RGBA.fromInts(120, 118, 112),
  })
  painter.setScheme("light")
  return { buffer: drive(painter, mockBuffer(HERO_W, HERO_H), to), w: HERO_W }
}

async function darkPainter(to: number) {
  const { HomeHeroPainter, HERO_W, HERO_H } = await import("../../src/component/home-hero-render")
  const { RGBA } = await import("@opentui/core")
  const painter = new HomeHeroPainter()
  painter.setTheme({
    background: RGBA.fromInts(12, 13, 16),
    primary: RGBA.fromInts(216, 166, 58),
    text: RGBA.fromInts(232, 230, 223),
    textMuted: RGBA.fromInts(107, 107, 118),
  })
  painter.setScheme("dark")
  return { buffer: drive(painter, mockBuffer(HERO_W, HERO_H), to), w: HERO_W }
}

test("light mode glow band is strongly damped versus dark", async () => {
  const light = await lightPainter(700)
  const dark = await darkPainter(700)
  const sample = (buffer: ReturnType<typeof mockBuffer>, w: number) => {
    const i = (4 * w + 35) * 4
    return [buffer.buffers.bg[i]!, buffer.buffers.bg[i + 1]!, buffer.buffers.bg[i + 2]!] as [number, number, number]
  }
  const lightDelta = channelDelta(sample(light.buffer, light.w), 245, 245, 242)
  const darkDelta = channelDelta(sample(dark.buffer, dark.w), 12, 13, 16)
  expect(lightDelta * 2).toBeLessThan(darkDelta)
})

test("light mode glint keeps the wordmark legible and still sweeps", async () => {
  const { TextAttributes } = await import("@opentui/core")
  const glint = await lightPainter(960)
  const calm = await lightPainter(700)
  const { buffers } = glint.buffer
  let minContrast = Number.POSITIVE_INFINITY
  let shifted = 0
  for (let i = 0; i < buffers.attributes.length; i++) {
    if ((buffers.attributes[i] ?? 0) !== TextAttributes.BOLD) continue
    const o = i * 4
    minContrast = Math.min(
      minContrast,
      channelDelta(
        [buffers.fg[o]!, buffers.fg[o + 1]!, buffers.fg[o + 2]!],
        buffers.bg[o]!,
        buffers.bg[o + 1]!,
        buffers.bg[o + 2]!,
      ),
    )
    if (
      channelDelta(
        [buffers.fg[o]!, buffers.fg[o + 1]!, buffers.fg[o + 2]!],
        calm.buffer.buffers.fg[o]!,
        calm.buffer.buffers.fg[o + 1]!,
        calm.buffer.buffers.fg[o + 2]!,
      ) >= 10
    )
      shifted++
  }
  expect(minContrast).toBeGreaterThanOrEqual(20)
  expect(shifted).toBeGreaterThan(0)
})

test("heroFits gates the full hero on width, height, and animation setting", async () => {
  const { heroFits, MIN_ART_WIDTH, MIN_ART_HEIGHT } = await import("../../src/component/logo")
  expect(heroFits({ width: 100, height: MIN_ART_HEIGHT, animationsEnabled: true })).toBe(true)
  expect(heroFits({ width: 100, height: MIN_ART_HEIGHT - 1, animationsEnabled: true })).toBe(false)
  expect(heroFits({ width: MIN_ART_WIDTH - 1, height: 40, animationsEnabled: true })).toBe(false)
  expect(heroFits({ width: 100, height: 40, animationsEnabled: false })).toBe(false)
})
