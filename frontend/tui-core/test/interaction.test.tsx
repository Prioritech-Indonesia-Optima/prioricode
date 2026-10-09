// Engine interaction layer: paint order by zIndex, mouse hit-testing with
// bubbling and stopPropagation, focus routing, overlay/Portal float layer.
/** @jsxImportSource @prioricode/tui-core/solid */
import { expect, test } from "bun:test"
import { createSignal, Show } from "solid-js"
import { createTestRenderer } from "../src/testing/test-renderer"
import { testRender } from "../src/solid/testing"
import { Portal } from "../src/solid/portal"
import type { MouseEventLike } from "../src/layout/engine"
import type { KeyEvent } from "../src/types"

const key = (name: string): KeyEvent => ({ name, sequence: name, raw: name, eventKind: "press", ctrl: false, alt: false, shift: false, meta: false })

test("mouse hit-testing targets the deepest node and bubbles", async () => {
  const app = await createTestRenderer({ width: 40, height: 8 })
  try {
    const outer = app.box({ width: 30, height: 6 })
    const inner = app.box({ width: 10, height: 3, marginLeft: 2, marginTop: 1 })
    outer.addChild(inner)
    app.root.addChild(outer)
    app.renderer.renderNow()
    const outerHits: string[] = []
    const innerHits: string[] = []
    outer.on("mouse:up", () => void outerHits.push("outer"))
    inner.on("mouse:up", () => void innerHits.push("inner"))
    const handled = app.renderer.handleMouse({ kind: "mouse", type: "up", button: 0, x: 4, y: 3, ctrl: false, alt: false, shift: false })
    expect(handled).toBe(true)
    expect(innerHits).toEqual(["inner"])
    expect(outerHits).toEqual(["outer"])
    expect(app.renderer.handleMouse({ kind: "mouse", type: "up", button: 0, x: 35, y: 7, ctrl: false, alt: false, shift: false })).toBe(false)
  } finally {
    app.destroy()
  }
})

test("stopPropagation halts the bubble and delivers local coordinates", async () => {
  const app = await createTestRenderer({ width: 40, height: 8 })
  try {
    const outer = app.box({ width: 30, height: 6 })
    const inner = app.box({ width: 10, height: 3, marginLeft: 2, marginTop: 1 })
    outer.addChild(inner)
    app.root.addChild(outer)
    app.renderer.renderNow()
    let outerSaw = 0
    let local: [number, number] | undefined
    outer.on("mouse:down", () => void outerSaw++)
    inner.on("mouse:down", (event: MouseEventLike) => {
      local = [event.localX, event.localY]
      event.stopPropagation()
    })
    app.renderer.handleMouse({ kind: "mouse", type: "down", button: 0, x: 5, y: 2, ctrl: false, alt: false, shift: false })
    expect(outerSaw).toBe(0)
    expect(local).toEqual([3, 1])
  } finally {
    app.destroy()
  }
})

test("zIndex reorders painting", async () => {
  const app = await createTestRenderer({ width: 20, height: 4 })
  try {
    const a = app.text({ content: "AAAA", wrap: "none" })
    const b = app.text({ content: "BBBB", wrap: "none" })
    b.restyle({ position: "absolute" })
    b.zIndex = 5
    app.root.addChild(a)
    app.root.addChild(b)
    await Bun.sleep(10)
    app.renderer.renderNow()
    expect(app.charFrame().split("\n")[0]).toContain("BBBB")
  } finally {
    app.destroy()
  }
})

test("focus routes keys; clicking a focusable node focuses it", async () => {
  const app = await createTestRenderer({ width: 20, height: 4 })
  try {
    const box = app.box({ width: 10, height: 1 })
    box.on("key", () => true)
    app.root.addChild(box)
    app.renderer.renderNow()
    let focused = 0
    let blurred = 0
    box.on("focus", () => void focused++)
    box.on("blur", () => void blurred++)
    expect(app.renderer.handleKey(key("a"))).toBe(false)
    app.renderer.focus(box)
    expect(app.renderer.handleKey(key("a"))).toBe(true)
    expect(focused).toBe(1)
    app.renderer.handleMouse({ kind: "mouse", type: "down", button: 0, x: 1, y: 0, ctrl: false, alt: false, shift: false })
    expect(app.renderer.focusedNode).toBe(box)
    app.renderer.focus(undefined)
    expect(blurred).toBe(1)
  } finally {
    app.destroy()
  }
})

test("Portal floats children into the overlay layer", async () => {
  const [show, setShow] = createSignal(false)
  const app = await testRender(
    () => (
      <box width={20} height={4} flexDirection="column">
        <text wrap="none">base</text>
        <Portal>
          <Show when={show()}>
            <box position="absolute" left={2} top={1} width={8} height={1} backgroundColor="#000000">
              <text wrap="none">float</text>
            </box>
          </Show>
        </Portal>
      </box>
    ),
    { width: 20, height: 4 },
  )
  try {
    expect(app.charFrame()).not.toContain("float")
    setShow(true)
    const frame = await app.waitForFrame((f) => f.includes("float"))
    expect(frame.split("\n")[1]).toContain("float")
    setShow(false)
    await Bun.sleep(20)
    app.renderer.renderNow()
    expect(app.charFrame()).not.toContain("float")
  } finally {
    app.dispose()
  }
})
