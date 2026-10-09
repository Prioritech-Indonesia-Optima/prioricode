// Golden-buffer parity: the same content tree is rendered by real OpenTUI and
// by tui-core; normalized char frames must match. OpenTUI's Solid testRender
// output is the oracle (verified against opentui 0.4.5).
/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createTestRenderer } from "../src/testing/test-renderer"
import { Renderable } from "../src/layout/engine"

function trimFrame(frame: string): string {
  return frame
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")
}

async function openTuiFrame(build: () => any, width: number, height: number): Promise<string> {
  const app = await testRender(build, { width, height })
  try {
    await Bun.sleep(120)
    return trimFrame(app.captureCharFrame())
  } finally {
    app.renderer.destroy()
  }
}

async function coreFrame(width: number, height: number, assemble: (app: Awaited<ReturnType<typeof createTestRenderer>>) => void): Promise<string> {
  const app = await createTestRenderer({ width, height })
  try {
    assemble(app)
    await Bun.sleep(20)
    app.renderer.renderNow()
    return trimFrame(app.charFrame())
  } finally {
    app.destroy()
  }
}

test("box with left-right borders and padded text matches OpenTUI", async () => {
  const want = await openTuiFrame(
    () => (
      <box border={["left", "right"]} paddingLeft={1} width={20} height={5}>
        <text width={17}>golden parity</text>
      </box>
    ),
    40,
    8,
  )
  const got = await coreFrame(40, 8, (app) => {
    const box = app.box({ border: ["left", "right"], paddingLeft: 1, width: 20, height: 5 })
    const text = app.text({ content: "golden parity", width: 17 })
    box.addChild(text)
    app.root.addChild(box)
  })
  expect(got).toBe(want)
})

test("simple text line matches OpenTUI", async () => {
  const want = await openTuiFrame(() => <text>plain line</text>, 40, 4)
  const got = await coreFrame(40, 4, (app) => {
    app.root.addChild(app.text({ content: "plain line" }))
  })
  expect(got).toBe(want)
})

test("stacked boxes match OpenTUI", async () => {
  const want = await openTuiFrame(
    () => (
      <box flexDirection="column" width={30} height={6} gap={1}>
        <box border={["top"]} width={28} height={2}>
          <text>first</text>
        </box>
        <box border={["bottom"]} width={28} height={2}>
          <text>second</text>
        </box>
      </box>
    ),
    40,
    8,
  )
  const got = await coreFrame(40, 8, (app) => {
    const col = new Renderable({ flexDirection: "column", width: 30, height: 6, gap: 1, display: "flex" })
    const top = app.box({ border: ["top"], width: 28, height: 2 })
    top.addChild(app.text({ content: "first" }))
    const bottom = app.box({ border: ["bottom"], width: 28, height: 2 })
    bottom.addChild(app.text({ content: "second" }))
    col.addChild(top)
    col.addChild(bottom)
    app.root.addChild(col)
  })
  expect(got).toBe(want)
})
