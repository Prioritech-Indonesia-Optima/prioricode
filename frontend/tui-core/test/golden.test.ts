// Golden-buffer parity against real OpenTUI. The oracle runs in a child
// process inside the frontend/tui package (which owns the universal Solid
// transform + OpenTUI runtime) and prints captured char frames; tui-core
// renders the same content tree and the normalized (right-trimmed) lines must
// match exactly. This gates the layout/text/border semantics shared by both
// engines and survives the reconciler split in later phases.
import { expect, test } from "bun:test"
import { createTestRenderer } from "../src/testing/test-renderer"
import { Renderable } from "../src/layout/engine"

type Goldens = Readonly<{ paddedBox: string[]; plainText: string[]; stackedBorders: string[] }>

async function oracle(): Promise<Goldens> {
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", "test/fixture/opentui-golden-oracle.tsx"],
    cwd: new URL("../../tui", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "inherit",
  })
  if (proc.exitCode !== 0) throw new Error("openTui oracle failed")
  return JSON.parse(proc.stdout.toString())
}

function normalize(lines: readonly string[]): string {
  return lines.map((line) => line.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "")
}

const goldens = await oracle()

async function coreFrame(
  width: number,
  height: number,
  assemble: (app: Awaited<ReturnType<typeof createTestRenderer>>) => void,
): Promise<string> {
  const app = await createTestRenderer({ width, height })
  try {
    assemble(app)
    await Bun.sleep(20)
    app.renderer.renderNow()
    return normalize(app.charFrame().split("\n"))
  } finally {
    app.destroy()
  }
}

test("box with left-right borders and padded text matches OpenTUI", async () => {
  const got = await coreFrame(40, 8, (app) => {
    const box = app.box({ border: ["left", "right"], paddingLeft: 1, width: 20, height: 5 })
    const text = app.text({ content: "golden parity", width: 17 })
    box.addChild(text)
    app.root.addChild(box)
  })
  expect(got).toBe(normalize(goldens.paddedBox))
})

test("simple text line matches OpenTUI", async () => {
  const got = await coreFrame(40, 4, (app) => {
    app.root.addChild(app.text({ content: "plain line" }))
  })
  expect(got).toBe(normalize(goldens.plainText))
})

test("stacked boxes match OpenTUI", async () => {
  const got = await coreFrame(40, 9, (app) => {
    const col = new Renderable({ flexDirection: "column", width: 30, height: 6, gap: 1, display: "flex" })
    const top = app.box({ border: ["top"], width: 28, height: 2 })
    top.addChild(app.text({ content: "first" }))
    const bottom = app.box({ border: ["bottom"], width: 28, height: 2 })
    bottom.addChild(app.text({ content: "second" }))
    col.addChild(top)
    col.addChild(bottom)
    app.root.addChild(col)
  })
  expect(got).toBe(normalize(goldens.stackedBorders))
})
