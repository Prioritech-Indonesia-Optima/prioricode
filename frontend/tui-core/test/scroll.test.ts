// ScrollBox renderable: viewport clipping, whole-row scroll offset state,
// sticky-to-bottom semantics, wheel handling, and scrollbar track painting.
import { expect, test } from "bun:test"
import { createTestRenderer } from "../src/testing/test-renderer"
import { ScrollBoxRenderable, SCROLL_WHEEL_ROWS } from "../src/primitives/scroll"
import { createElementTag } from "../src/solid/renderer"

function fill(scroll: ScrollBoxRenderable, app: Awaited<ReturnType<typeof createTestRenderer>>, rows: number, prefix = "ROW"): void {
  for (let i = 0; i < rows; i++) scroll.addChild(app.text({ content: `${prefix}${i}`, wrap: "none" }))
}

test("clips children outside the viewport and never paints off-screen rows", async () => {
  const app = await createTestRenderer({ width: 20, height: 4 })
  try {
    const scroll = app.scrollbox({ width: 20, height: 4, stickyScroll: false, verticalScrollbarOptions: { visible: false } })
    fill(scroll, app, 6)
    app.root.addChild(scroll)
    app.renderer.renderNow()
    expect(scroll.scrollHeight).toBe(6)
    expect(scroll.visibleHeight).toBe(4)
    expect(scroll.y).toBe(0)
    const lines = app.charFrame().split("\n")
    expect(lines[0]).toBe("ROW0")
    expect(lines[3]).toBe("ROW3")
    expect(app.charFrame()).not.toContain("ROW4")
    expect(app.charFrame()).not.toContain("ROW5")

    scroll.scrollTo(2)
    app.renderer.renderNow()
    const shifted = app.charFrame().split("\n")
    expect(shifted[0]).toBe("ROW2")
    expect(shifted[3]).toBe("ROW5")
    expect(app.charFrame()).not.toContain("ROW0")
    expect(app.charFrame()).not.toContain("ROW1")
  } finally {
    app.destroy()
  }
})

test("scrollBy and scrollTo clamp to whole rows within bounds", async () => {
  const app = await createTestRenderer({ width: 20, height: 4 })
  try {
    const scroll = app.scrollbox({ width: 20, height: 4, stickyScroll: false, verticalScrollbarOptions: { visible: false } })
    fill(scroll, app, 6)
    app.root.addChild(scroll)
    app.renderer.renderNow()
    expect(scroll.maxScroll).toBe(2)

    scroll.scrollBy(-10)
    expect(scroll.y).toBe(0)
    scroll.scrollTo(-5)
    expect(scroll.y).toBe(0)
    scroll.scrollBy(999)
    expect(scroll.y).toBe(2)
    scroll.scrollTo(9999)
    expect(scroll.y).toBe(2)
    scroll.scrollTo(1)
    expect(scroll.y).toBe(1)
    scroll.scrollTo(1.7)
    expect(scroll.y).toBe(1)
  } finally {
    app.destroy()
  }
})

test("sticky scroll pins at end, survives content growth, and is disabled by scrolling away", async () => {
  const app = await createTestRenderer({ width: 10, height: 3 })
  try {
    const scroll = app.scrollbox({ width: 10, height: 3, verticalScrollbarOptions: { visible: false } })
    expect(scroll.stickyScroll).toBe(true)
    fill(scroll, app, 5, "A")
    app.root.addChild(scroll)
    app.renderer.renderNow()
    expect(scroll.y).toBe(2)
    let frame = app.charFrame()
    expect(frame).toContain("A4")
    expect(frame).not.toContain("A0")

    scroll.addChild(app.text({ content: "A5", wrap: "none" }))
    app.renderer.renderNow()
    expect(scroll.scrollHeight).toBe(6)
    expect(scroll.y).toBe(3)
    frame = app.charFrame()
    expect(frame).toContain("A5")
    expect(frame).not.toContain("A2")

    scroll.scrollTo(0)
    expect(scroll.stickyScroll).toBe(false)
    app.renderer.renderNow()
    expect(app.charFrame()).toContain("A0")

    scroll.addChild(app.text({ content: "A6", wrap: "none" }))
    app.renderer.renderNow()
    expect(scroll.y).toBe(0)
    frame = app.charFrame()
    expect(frame).toContain("A0")
    expect(frame).not.toContain("A6")

    scroll.scrollTo(scroll.scrollHeight)
    expect(scroll.stickyScroll).toBe(true)
    expect(scroll.y).toBe(4)
    app.renderer.renderNow()
    frame = app.charFrame()
    expect(frame).toContain("A6")
    expect(frame).not.toContain("A2")
  } finally {
    app.destroy()
  }
})

test("scrollToEnd pins to the bottom of the content", async () => {
  const app = await createTestRenderer({ width: 10, height: 4 })
  try {
    const scroll = app.scrollbox({ width: 10, height: 4, stickyScroll: false, verticalScrollbarOptions: { visible: false } })
    fill(scroll, app, 10, "B")
    app.root.addChild(scroll)
    app.renderer.renderNow()
    scroll.scrollTo(0)
    app.renderer.renderNow()
    expect(app.charFrame()).not.toContain("B9")
    scroll.scrollToEnd()
    expect(scroll.y).toBe(scroll.maxScroll)
    expect(scroll.stickyScroll).toBe(true)
    app.renderer.renderNow()
    const lines = app.charFrame().split("\n")
    expect(lines[0]).toBe("B6")
    expect(lines[3]).toBe("B9")
  } finally {
    app.destroy()
  }
})

test("wheel events scroll three rows and stop propagation when handled", async () => {
  const app = await createTestRenderer({ width: 10, height: 4 })
  try {
    const scroll = app.scrollbox({ width: 10, height: 4, stickyScroll: false, verticalScrollbarOptions: { visible: false } })
    fill(scroll, app, 10, "B")
    app.root.addChild(scroll)
    app.renderer.renderNow()
    scroll.scrollTo(0)
    app.renderer.renderNow()
    expect(scroll.y).toBe(0)

    const handledDown = app.renderer.handleMouse({ kind: "mouse", type: "wheelDown", button: 0, x: 5, y: 2, ctrl: false, alt: false, shift: false })
    expect(handledDown).toBe(true)
    expect(scroll.y).toBe(SCROLL_WHEEL_ROWS)
    app.renderer.renderNow()
    expect(app.charFrame().split("\n")[0]).toBe("B3")

    app.renderer.handleMouse({ kind: "mouse", type: "wheelUp", button: 0, x: 5, y: 2, ctrl: false, alt: false, shift: false })
    expect(scroll.y).toBe(0)
    app.renderer.handleMouse({ kind: "mouse", type: "wheelUp", button: 0, x: 5, y: 2, ctrl: false, alt: false, shift: false })
    expect(scroll.y).toBe(0)

    const outside = app.renderer.handleMouse({ kind: "mouse", type: "wheelDown", button: 0, x: 15, y: 2, ctrl: false, alt: false, shift: false })
    expect(outside).toBe(false)
    expect(scroll.y).toBe(0)
  } finally {
    app.destroy()
  }
})

test("visible scrollbar paints a proportional thumb in the last column", async () => {
  const app = await createTestRenderer({ width: 10, height: 6 })
  try {
    const scroll = app.scrollbox({
      width: 10,
      height: 6,
      stickyScroll: false,
      verticalScrollbarOptions: { visible: true, trackOptions: { foregroundColor: "#ff0000", backgroundColor: "#000011" } },
    })
    fill(scroll, app, 12, "C")
    app.root.addChild(scroll)
    scroll.scrollTo(0)
    app.renderer.renderNow()
    expect(scroll.scrollHeight).toBe(12)
    const cells = app.renderer.currentCells()
    const at = (x: number, y: number) => cells[y * 10 + x]
    // thumb = round(6*6/12) = 3 rows of foreground at the top when y = 0
    for (let row = 0; row < 6; row++) expect(at(9, row).bg).toBe(row < 3 ? 0xff0000 : 0x000011)

    scroll.scrollTo(6)
    app.renderer.renderNow()
    const moved = app.renderer.currentCells()
    const atAfter = (x: number, y: number) => moved[y * 10 + x]
    for (let row = 0; row < 6; row++) expect(atAfter(9, row).bg).toBe(row >= 3 ? 0xff0000 : 0x000011)
    const lines = app.charFrame().split("\n")
    expect(lines[0]).toBe("C6")
    expect(lines[5]).toBe("C11")
  } finally {
    app.destroy()
  }
})

test("hidden scrollbar consumes no column", async () => {
  const app = await createTestRenderer({ width: 20, height: 2 })
  try {
    const scroll = app.scrollbox({ width: 20, height: 2, stickyScroll: false, verticalScrollbarOptions: { visible: false } })
    scroll.addChild(app.text({ content: "A".repeat(20), wrap: "none" }))
    app.root.addChild(scroll)
    app.renderer.renderNow()
    expect(app.charFrame().split("\n")[0]).toHaveLength(20)

    scroll.verticalScrollbarOptions = { visible: true }
    scroll.markDirty()
    app.renderer.renderNow()
    expect(app.charFrame().split("\n")[0]).toHaveLength(19)
  } finally {
    app.destroy()
  }
})

test("viewport padding offsets children without changing scroll extents", async () => {
  const app = await createTestRenderer({ width: 20, height: 6 })
  try {
    const scroll = app.scrollbox({
      width: 20,
      height: 6,
      stickyScroll: false,
      viewportOptions: { paddingLeft: 3, paddingTop: 2 },
      verticalScrollbarOptions: { visible: false },
    })
    scroll.addChild(app.text({ content: "TOP", wrap: "none" }))
    const nested = app.box({ paddingLeft: 1, height: 1 })
    nested.addChild(app.text({ content: "IN", wrap: "none" }))
    scroll.addChild(nested)
    app.root.addChild(scroll)
    scroll.scrollTo(0)
    app.renderer.renderNow()
    const lines = app.charFrame().split("\n")
    expect(lines[0]).toBe("")
    expect(lines[1]).toBe("")
    expect(lines[2]).toBe("   TOP")
    expect(lines[3]).toBe("    IN")
    expect(scroll.visibleHeight).toBe(4)
    expect(scroll.scrollHeight).toBe(2)
  } finally {
    app.destroy()
  }
})

test("children are added to the inner content wrapper, not the viewport node", async () => {
  const app = await createTestRenderer({ width: 10, height: 3 })
  try {
    const scroll = app.scrollbox({ width: 10, height: 3, verticalScrollbarOptions: { visible: false } })
    fill(scroll, app, 2, "D")
    expect(scroll.children.length).toBe(1)
    expect(scroll.children[0]).toBe(scroll.content)
    expect(scroll.content.children.length).toBe(2)
    const first = scroll.content.children[0]
    scroll.removeChild(first)
    expect(scroll.content.children.length).toBe(1)
    app.root.addChild(scroll)
    app.renderer.renderNow()
    expect(scroll.scrollHeight).toBe(1)
  } finally {
    app.destroy()
  }
})

test("solid bridge creates scrollbox elements", () => {
  const node = createElementTag("scrollbox")
  expect(node).toBeInstanceOf(ScrollBoxRenderable)
})
