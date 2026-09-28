import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { GoUpsellArtPainter } from "../../src/component/bg-pulse-render"

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function snapshotBg(buffer: ReturnType<typeof mockBuffer>) {
  return Array.from(buffer.buffers.bg)
}

test("GoUpsellArtPainter.setScheme is idempotent and invalidates the frame cache", () => {
  const w = 40
  const h = 12
  const painter = new GoUpsellArtPainter()
  painter.setBackgroundPanel(RGBA.fromInts(20, 20, 24))
  painter.setPrimary(RGBA.fromInts(216, 166, 58))
  painter.setLogoBase(RGBA.fromInts(150, 150, 150))

  // Warm the cache at a fixed elapsed time in dark mode.
  const dark = mockBuffer(w, h)
  for (let i = 0; i < 60; i++) painter.render(dark, { deltaTime: 30 })
  expect(painter.setScheme("dark")).toBe(false)

  // Switching to light must rebuild (not replay) the cached dark frames.
  expect(painter.setScheme("light")).toBe(true)
  const light = mockBuffer(w, h)
  for (let i = 0; i < 60; i++) painter.render(light, { deltaTime: 30 })

  expect(snapshotBg(light)).not.toEqual(snapshotBg(dark))
})

test("light-mode ring wash is damped versus dark", () => {
  const w = 40
  const h = 12
  const render = (scheme: "dark" | "light") => {
    const painter = new GoUpsellArtPainter()
    const panel = scheme === "light" ? RGBA.fromInts(245, 245, 242) : RGBA.fromInts(20, 20, 24)
    painter.setBackgroundPanel(panel)
    painter.setPrimary(RGBA.fromInts(216, 166, 58))
    painter.setLogoBase(scheme === "light" ? RGBA.fromInts(90, 88, 84) : RGBA.fromInts(150, 150, 150))
    painter.setScheme(scheme)
    const buffer = mockBuffer(w, h)
    for (let i = 0; i < 60; i++) painter.render(buffer, { deltaTime: 30 })
    const base = scheme === "light" ? [245, 245, 242] : [20, 20, 24]
    let maxDelta = 0
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      maxDelta = Math.max(
        maxDelta,
        Math.abs(buffer.buffers.bg[o]! - base[0]),
        Math.abs(buffer.buffers.bg[o + 1]! - base[1]),
        Math.abs(buffer.buffers.bg[o + 2]! - base[2]),
      )
    }
    return maxDelta
  }
  expect(render("light")).toBeLessThan(render("dark"))
})
