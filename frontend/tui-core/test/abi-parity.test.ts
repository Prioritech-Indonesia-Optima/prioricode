// Cross-engine parity contract for the plugin ABI transition: tui-core's
// OpenTUI-compat implementations (RGBA, binding lookup, vignette) must behave
// identically to the real @opentui packages for deterministic inputs, and both
// EngineSurface implementations must satisfy the neutral contract.
import { expect, test } from "bun:test"
import { RGBA as OpenTuiRGBA, VignetteEffect as OpenTuiVignette } from "@opentui/core"
import { createBindingLookup as openTuiCreateBindingLookup } from "@opentui/keymap/extras"
import { RGBA } from "../src/compat/rgba"
import { VignetteEffect } from "../src/compat/effects"
import { createBindingLookup } from "../src/compat/bindings"
import { createTuiCoreSurface } from "../src/abi/surface"
import { createOpenTuiSurface } from "@prioricode/tui-abi/adapters/opentui"
import { createTestRenderer } from "../src/testing/test-renderer"
import { createKeymap } from "../src/keymap/keymap"
import { CellBuffer } from "../src/render/cell"

test("RGBA fromHex parity with @opentui/core", () => {
  for (const hex of ["#5f87ff", "#1d1d1d", "#abc", "#000000", "#ffffff", "ff8800"]) {
    expect(RGBA.fromHex(hex).toInts()).toEqual(OpenTuiRGBA.fromHex(hex).toInts())
  }
})

test("RGBA fromInts parity including alpha", () => {
  const inputs = [
    [1, 2, 3] as const,
    [0, 0, 0, 160] as const,
    [255, 255, 255, 0] as const,
    [95, 135, 255, 255] as const,
  ]
  for (const [r, g, b, a] of inputs) {
    expect(RGBA.fromInts(r, g, b, a).toInts()).toEqual(OpenTuiRGBA.fromInts(r, g, b, a).toInts())
  }
})

test("RGBA float channels parity", () => {
  const mine = RGBA.fromInts(1, 2, 3, 160)
  const theirs = OpenTuiRGBA.fromInts(1, 2, 3, 160)
  expect([mine.r, mine.g, mine.b, mine.a]).toEqual([theirs.r, theirs.g, theirs.b, theirs.a])
})

test("binding lookup gather parity (order, arrays, false, missing)", () => {
  const config: Record<string, string | string[] | false> = {
    "a.b": "ctrl+shift+m",
    "a.c": ["left", "h"],
    "a.d": false,
    "cmd.palette.show": "ctrl+p",
    "chain.a": "enter,return",
  }
  const commands = ["a.b", "a.c", "a.d", "a.missing", "cmd.palette.show", "chain.a"]
  const theirs = (openTuiCreateBindingLookup(config) as unknown as { gather(n: string, c: string[]): { key: string; cmd: string }[] }).gather("ns", commands)
  expect(createBindingLookup(config).gather("ns", commands)).toEqual(theirs)
})

test("vignette exists in OpenTUI-compatible form and darkens edge cells", () => {
  expect(typeof OpenTuiVignette).toBe("function")
  const buffer = new CellBuffer(21, 11)
  buffer.fillRect(0, 0, 21, 11, 0x808080)
  const effect = new VignetteEffect(0.6)
  effect.apply(buffer, 0)
  const corner = buffer.get(0, 0)!
  const center = buffer.get(10, 5)!
  expect(corner.bg).toBeLessThan(center.bg)
  expect(center.bg).toBeGreaterThan(0x808080 * 0.6)
})

test("tui-core surface satisfies the neutral contract end-to-end", async () => {
  const app = await createTestRenderer({ width: 30, height: 6 })
  const keymap = createKeymap()
  const surface = createTuiCoreSurface({ renderer: app.renderer, keymap })
  try {
    expect(surface.abiVersion).toBe(1)
    expect(surface.renderer.width).toBe(30)
    expect(surface.renderer.height).toBe(6)
    const before = app.output()
    surface.renderer.setTerminalTitle("hello")
    expect(app.output().slice(before.length)).toBe("\x1b]0;hello\x07")

    const lookups = surface.createBindingLookup({ "x.y": "ctrl+k" })
    expect(lookups.gather("ns", ["x.y"])).toEqual([{ key: "ctrl+k", cmd: "x.y" }])

    const effect = surface.vignette(0.5)
    expect(effect.kind).toBe("vignette")
    expect(effect.strength).toBe(0.5)

    let called = 0
    const pass = () => {
      called++
    }
    surface.renderer.addPostProcessFn(pass)
    surface.renderer.removePostProcessFn(pass)
    expect(called).toBe(0)

    const color = surface.color("#5f87ff")
    expect(color.toInts()).toEqual([95, 135, 255, 255])
    expect(color.toHex()).toBe("#5f87ff")
    expect(surface.formatKeyEvent({ name: "m", sequence: "", ctrl: true, alt: false, shift: true, meta: false, eventKind: "press" })).toBe(
      "ctrl+shift+m",
    )
  } finally {
    app.destroy()
  }
})

test("opentui surface adapter wraps a renderer-like object", async () => {
  const app = await createTestRenderer({ width: 20, height: 4 })
  try {
    const titles: string[] = []
    const postFns: unknown[] = []
    const surface = createOpenTuiSurface({
      width: 80,
      height: 24,
      setTerminalTitle: (t: string) => void titles.push(t),
      addPostProcessFn: (fn: unknown) => void postFns.push(fn),
      removePostProcessFn: (fn: unknown) => postFns.splice(postFns.indexOf(fn), 1),
      requestRender: () => app.renderer.renderNow(),
    })
    expect(surface.abiVersion).toBe(1)
    expect(surface.renderer.width).toBe(80)
    surface.renderer.setTerminalTitle("x")
    expect(titles).toEqual(["x"])
    const fn = () => {}
    surface.renderer.addPostProcessFn(fn)
    expect(postFns.length).toBe(1)
    surface.renderer.removePostProcessFn(fn)
    expect(postFns.length).toBe(0)
    expect(surface.color("#ffffff").toInts()).toEqual([255, 255, 255, 255])
    expect(surface.createBindingLookup({ "a.b": "ctrl+j" }).gather("ns", ["a.b"])).toEqual([{ key: "ctrl+j", cmd: "a.b" }])
    expect(surface.vignette(0.2)).toBeDefined()
  } finally {
    app.destroy()
  }
})
