/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const WORDMARK = "PrioriCode"
const TAGLINE = "the open source AI coding agent"

async function harness(width: number) {
  const rootDir = await tmpdir()
  const root = rootDir.path
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [{ Logo }, { KVProvider }, { ThemeProvider }, { TuiConfigProvider }, { TestTuiContexts }, { big }] =
    await Promise.all([
      import("../../src/component/logo"),
      import("../../src/context/kv"),
      import("../../src/context/theme"),
      import("../../src/config"),
      import("../fixture/tui-environment"),
      import("../../src/logo"),
    ])

  function Wrapper() {
    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <TuiConfigProvider config={createTuiResolvedConfig({})}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <Logo />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Wrapper />, { width, height: 30 })
  return { app, big, cleanup: () => rootDir[Symbol.asyncDispose]() }
}

const collect = (node: any, out: any[]) => {
  if (!node) return
  if (node.constructor?.name === "TextRenderable") out.push(node)
  for (const child of node.getChildren?.() ?? []) collect(child, out)
}

const visible = (frame: string) =>
  frame
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

test("home hero reveals the block-letter wordmark once, then settles", async () => {
  const { app, big, cleanup } = await harness(100)
  try {
    const want = [...big.map((line) => line.trimEnd()), TAGLINE]
    let lines: string[] = []
    for (let i = 0; i < 60; i++) {
      await app.renderOnce()
      lines = visible(app.captureCharFrame())
      if (lines.length === want.length && lines.every((line, index) => line === want[index])) break
      await Bun.sleep(50)
    }
    expect(lines).toEqual(want)
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})

test("block letters carry a multi-stop warm gradient and stay static after the glint", async () => {
  const { app, cleanup } = await harness(100)
  try {
    await Bun.sleep(1400)
    const warmFg = () => {
      const texts: any[] = []
      collect((app.renderer as any).root, texts)
      const warm = new Set<string>()
      for (const text of texts) {
        const [r, g, b] = text.fg?.toInts?.() ?? [0, 0, 0, 0]
        if (r - b > 40) warm.add(`${r},${g},${b}`)
      }
      return warm
    }
    await app.renderOnce()
    const first = warmFg()
    expect(first.size).toBeGreaterThan(2)

    await Bun.sleep(1500)
    await app.renderOnce()
    const second = warmFg()
    expect([...second].sort()).toEqual([...first].sort())
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})

test("narrow terminals fall back to the compact wordmark hero", async () => {
  const { app, cleanup } = await harness(60)
  try {
    const want = [WORDMARK, TAGLINE]
    let lines: string[] = []
    for (let i = 0; i < 60; i++) {
      await app.renderOnce()
      lines = visible(app.captureCharFrame())
      if (lines.length === want.length && lines.every((line, index) => line === want[index])) break
      await Bun.sleep(50)
    }
    expect(lines).toEqual(want)
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})
