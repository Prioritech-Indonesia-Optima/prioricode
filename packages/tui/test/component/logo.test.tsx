/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const WORDMARK = [
  ".+.++",
  " .***+",
  "  ++.++***%%##########################%:",
  "      %%%******%%#######################%.",
  "      ..... ++****+:...............::#####",
  "               .+****+.              %####",
  "             :%%%%%*****+.%%%%%%%%%%#####%",
  "             %######%+****+%############:",
  "             %####%%%%:+****+%%%%%%%%%:    PrioriCode",
  "             %####  :%%%:****+.%%%%%%:",
  "             %####  %####.****+%#####%",
  "             %###%  %%%%%:+****+%%%%%:",
  "                          .****+",
  "                           ****+",
  "                           ****+",
  "                           ****+",
]

test("home logo renders the full wordmark once the reveal animation completes", async () => {
  await using dir = await tmpdir()
  const root = dir.path
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

  function Harness() {
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

  const app = await testRender(() => <Harness />)
  try {
    const visible = (frame: string) =>
      frame
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
        .join("\n")
    const expected = WORDMARK.join("\n")
    let frame = ""
    for (let i = 0; i < 60; i++) {
      await app.renderOnce()
      frame = visible(app.captureCharFrame())
      if (frame === expected) break
      await Bun.sleep(50)
    }
    expect(frame).toEqual(expected)
  } finally {
    app.renderer.destroy()
  }
})

test("home logo sweeps a primary-tinted glint across the wordmark", async () => {
  await using dir = await tmpdir()
  const root = dir.path
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

  function Harness() {
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

  const app = await testRender(() => <Harness />)
  try {
    const collect = (node: any, out: any[]) => {
      if (!node) return
      if (node.constructor?.name === "TextRenderable") out.push(node)
      for (const child of node.getChildren?.() ?? []) collect(child, out)
    }
    await Bun.sleep(900)
    const seen = new Set<string>()
    let tinted = 0
    for (let i = 0; i < 40; i++) {
      await app.renderOnce()
      const texts: any[] = []
      collect((app.renderer as any).root, texts)
      for (const text of texts) {
        const [r, g, b] = text.fg?.toInts?.() ?? [0, 0, 0, 0]
        if (r - b > 40) {
          tinted++
          seen.add(`${r},${g},${b}`)
        }
      }
      if (tinted > 0 && seen.size > 2) break
      await Bun.sleep(100)
    }
    expect(tinted).toBeGreaterThan(0)
    expect(seen.size).toBeGreaterThan(2)
  } finally {
    app.renderer.destroy()
  }
})
