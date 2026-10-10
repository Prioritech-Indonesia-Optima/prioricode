import { expect, test } from "bun:test"
import { createLayoutEngine, layoutEngine, Renderable } from "../src/layout/engine"
import { BoxRenderable } from "../src/primitives/box"
import { TextRenderable } from "../src/primitives/text"

await createLayoutEngine()

function makeStatusRow(width: number): Renderable {
  const root = new Renderable({ flexDirection: "row", width, height: 1, display: "flex" })
  const content = new Renderable({
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    height: 1,
    display: "flex",
    overflow: "hidden",
  })
  const long = new TextRenderable({
    content: "Error: 429 this model's maximum context length is 200000 tokens, please retry later",
    wrap: "none",
  })
  content.addChild(long)
  const hint = new TextRenderable({ content: "esc interrupt", wrap: "none" })
  root.addChild(content)
  root.addChild(hint)
  return root
}

test("no node exceeds its parent bounds at any width (clamped)", () => {
  for (let width = 1; width <= 160; width++) {
    const root = makeStatusRow(width)
    const report = layoutEngine().calculate(root, width, 1)
    const check = (node: Renderable, parent: Renderable | undefined) => {
      const r = node.layoutRect
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(width + 0.5)
      if (parent) {
        const p = parent.layoutRect
        expect(r.x + r.width).toBeLessThanOrEqual(p.x + p.width + 0.5)
        expect(r.y + r.height).toBeLessThanOrEqual(p.y + p.height + 0.5)
      }
      for (const child of node.children) check(child, node)
    }
    check(root, undefined)
    void report
  }
})

test("nested boxes cannot overflow the viewport at any size", () => {
  const root = new Renderable({ width: "100%", height: "100%", flexDirection: "column", display: "flex" })
  const panel = new BoxRenderable({ border: ["left", "right"], flexGrow: 1, minHeight: 0 })
  const body = new TextRenderable({ content: "x".repeat(4000), wrap: "word" })
  panel.addChild(body)
  root.addChild(panel)
  for (const [w, h] of [
    [80, 24],
    [40, 12],
    [120, 40],
    [15, 5],
    [9, 3],
  ] as const) {
    const report = layoutEngine().calculate(root, w, h)
    expect(panel.layoutRect.x + panel.layoutRect.width).toBeLessThanOrEqual(w)
    expect(body.layoutRect.width).toBeLessThanOrEqual(w)
    expect(body.layoutRect.height).toBeLessThanOrEqual(h)
    expect(report.clamped === true || report.violations.length === 0).toBe(true)
  }
})
