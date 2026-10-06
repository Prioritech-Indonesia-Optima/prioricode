/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

// Regression for the reported "c u r r e n t" bug: a DialogSelect option footer
// with no wrapMode="none" collapsed to one-char-per-line when the terminal was
// narrow (flexbox min-width:auto let the flexShrink={0} box shrink to its
// 1-char min-content). At 30 cols the footer must stay a contiguous run.
async function mount(width: number) {
  const rootDir = await tmpdir()
  const root = rootDir.path
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { DialogSelect },
    { DialogProvider, useDialog },
    { ClipboardProvider },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { PrioricodeKeymapProvider, registerPrioricodeKeymap },
  ] = await Promise.all([
    import("../../src/ui/dialog-select"),
    import("../../src/ui/dialog"),
    import("../../src/context/clipboard"),
    import("../../src/context/kv"),
    import("../../src/context/theme"),
    import("../../src/config"),
    import("../../src/ui/toast"),
    import("../../src/keymap"),
  ])

  function Trigger() {
    const dialog = useDialog()
    onCleanup(() => dialog.clear())
    dialog.replace(() => (
      <DialogSelect
        title="Models"
        options={[
          { value: "a", title: "Some Very Long Model Name Here", footer: "current" },
          { value: "b", title: "B", description: "beta" },
        ]}
      />
    ))
    return <box />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({})
    const off = registerPrioricodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)
    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <PrioricodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <ClipboardProvider>
                    <DialogProvider>
                      <Trigger />
                    </DialogProvider>
                  </ClipboardProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </PrioricodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width, height: 16 })
  return { app, cleanup: () => rootDir[Symbol.asyncDispose]() }
}

const singleCharLines = (frame: string) =>
  frame.split("\n").filter((line) => line.trim().length === 1 && /^[a-z]$/.test(line.trim()))

test("option footer stays a contiguous run at 30 columns (no vertical collapse)", async () => {
  const { app, cleanup } = await mount(30)
  try {
    let frame = ""
    for (let i = 0; i < 40; i++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("current")) break
      await Bun.sleep(20)
    }
    expect(frame).toContain("current")
    expect(singleCharLines(frame)).toEqual([])
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})

test("option description stays contiguous at 30 columns", async () => {
  const { app, cleanup } = await mount(30)
  try {
    let frame = ""
    for (let i = 0; i < 40; i++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("beta")) break
      await Bun.sleep(20)
    }
    expect(frame).toContain("beta")
    expect(singleCharLines(frame)).toEqual([])
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})
