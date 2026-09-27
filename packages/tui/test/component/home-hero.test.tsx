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
