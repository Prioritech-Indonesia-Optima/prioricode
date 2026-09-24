/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const HERO = ["PrioriCode", "the open source AI coding agent"]

async function harness() {
  const rootDir = await tmpdir()
  const root = rootDir.path
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [{ Logo }, { KVProvider }, { ThemeProvider }, { TuiConfigProvider }, { TestTuiContexts }] = await Promise.all([
    import("../../src/component/logo"),
    import("../../src/context/kv"),
    import("../../src/context/theme"),
    import("../../src/config"),
    import("../fixture/tui-environment"),
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

  const app = await testRender(() => <Wrapper />)
  return { app, cleanup: () => rootDir[Symbol.asyncDispose]() }
}

const collect = (node: any, out: any[]) => {
  if (!node) return
  if (node.constructor?.name === "TextRenderable") out.push(node)
  for (const child of node.getChildren?.() ?? []) collect(child, out)
}

test("home hero reveals the gradient wordmark once, then settles", async () => {
  const { app, cleanup } = await harness()
  try {
    const visible = (frame: string) =>
      frame
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    let lines: string[] = []
    for (let i = 0; i < 60; i++) {
      await app.renderOnce()
      lines = visible(app.captureCharFrame())
      if (lines.join("\n") === HERO.join("\n")) break
      await Bun.sleep(50)
    }
    expect(lines).toEqual(HERO)
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})

test("wordmark carries a multi-stop warm gradient and stays static after reveal", async () => {
  const { app, cleanup } = await harness()
  try {
    await Bun.sleep(900)
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
