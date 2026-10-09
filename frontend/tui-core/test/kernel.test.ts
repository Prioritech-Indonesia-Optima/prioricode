import { expect, test } from "bun:test"
import { createTestRenderer } from "../src/testing/test-renderer"
import { Renderable } from "../src/layout/engine"

test("renders nested boxes with text", async () => {
  const app = await createTestRenderer({ width: 40, height: 10 })
  try {
    const outer = app.box({ border: "all", borderColor: "#ff0000", width: 20, height: 5 })
    const inner = app.box({ width: 18, height: 3, marginLeft: 1, marginTop: 1 })
    const label = app.text({ content: "hello world", fg: "#00ff00" })
    inner.addChild(label)
    outer.addChild(inner)
    app.root.addChild(outer)
    const frame = await app.waitForFrame((f) => f.includes("hello world"))
    const lines = frame.split("\n")
    expect(lines[0]).toBe("┌──────────────────┐")
    expect(lines[2]).toBe("│ hello world      │")
    expect(lines[4]).toBe("└──────────────────┘")
  } finally {
    app.destroy()
  }
})

test("long text truncates instead of overflowing", async () => {
  const app = await createTestRenderer({ width: 30, height: 6 })
  try {
    const box = app.box({ width: 10, height: 1 })
    const text = app.text({ content: "0123456789abcdefghijklmnop", wrap: "none" })
    box.addChild(text)
    app.root.addChild(box)
    app.renderer.renderNow()
    const frame = app.charFrame()
    for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(30)
    const violations = frame.includes("0123456789abcdefghi")
    expect(violations).toBe(false)
  } finally {
    app.destroy()
  }
})

test("idle scheduler emits zero frames", async () => {
  const app = await createTestRenderer({ width: 30, height: 6 })
  try {
    const before = app.frameCount()
    await Bun.sleep(120)
    expect(app.frameCount()).toBe(before)
  } finally {
    app.destroy()
  }
})

test("wide characters occupy two cells", async () => {
  const app = await createTestRenderer({ width: 20, height: 4 })
  try {
    const text = app.text({ content: "日本語x" })
    app.root.addChild(text)
    await app.waitForFrame((f) => f.includes("x"))
    expect(app.charFrame().split("\n")[0]).toContain("日本語x")
  } finally {
    app.destroy()
  }
})

test("flex row shrink distributes to flexible children", async () => {
  const app = await createTestRenderer({ width: 40, height: 3 })
  try {
    const row = new Renderable({ flexDirection: "row", width: "100%" })
    const pinned = app.text({ content: "fixed", wrap: "none" })
    const growable = app.box({ flexGrow: 1, minWidth: 0, height: 1 })
    row.addChild(pinned)
    row.addChild(growable)
    app.root.addChild(row)
    await Bun.sleep(10)
    app.renderer.renderNow()
    expect(growable.layoutRect.width).toBeLessThanOrEqual(40 - 5)
    expect(pinned.layoutRect.width).toBeGreaterThanOrEqual(5)
  } finally {
    app.destroy()
  }
})

test("compat props: backgroundColor, textColor, padding shorthand, right/bottom, truncate ellipsis", async () => {
  const app = await createTestRenderer({ width: 30, height: 8 })
  try {
    const box = app.box({})
    box.restyle({ bg: "#336699", padding: 2, width: 20 })
    const text = app.text({ content: "0123456789abcdefghij" })
    text.restyle({ fg: "#ff0000" })
    text.truncate = true
    text.wrap = "none"
    box.addChild(text)
    const badge = app.box({})
    badge.restyle({ position: "absolute", right: 2, bottom: 1, width: 4, height: 1 })
    const badgeText = app.text({ content: "BR" })
    badge.addChild(badgeText)
    app.root.addChild(box)
    app.root.addChild(badge)
    await Bun.sleep(10)
    app.renderer.renderNow()
    const frame = app.charFrame()
    // padding 2 → text starts at column 2
    expect(frame.split("\n")[2]).toBe("  0123456789abcde…")
    // absolute bottom-right anchoring
    expect(frame.split("\n")[6]).toContain("BR")
    // backgroundColor fills cells with the parsed color
    const cell = app.renderer.currentCells()[2 * 30 + 2]
    expect(cell.bg).toBe(0x336699)
    expect(cell.fg).toBe(0xff0000)
  } finally {
    app.destroy()
  }
})
