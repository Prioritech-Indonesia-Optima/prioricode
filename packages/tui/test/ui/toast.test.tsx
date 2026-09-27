/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { ArgsProvider } from "../../src/context/args"
import { KVProvider } from "../../src/context/kv"
import { TuiConfigProvider } from "../../src/config"
import { ThemeProvider } from "../../src/context/theme"
import { Toast, ToastProvider, useToast, type ToastContext } from "../../src/ui/toast"

async function harness() {
  const rootDir = await tmpdir()
  const root = rootDir.path
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  let toast!: ToastContext
  function Probe() {
    toast = useToast()
    return <box />
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <ArgsProvider>
          <KVProvider>
            <TuiConfigProvider config={createTuiResolvedConfig({})}>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <Toast />
                  <Probe />
                </ToastProvider>
              </ThemeProvider>
            </TuiConfigProvider>
          </KVProvider>
        </ArgsProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 16 },
  )
  const start = Date.now()
  while (!toast) {
    if (Date.now() - start > 5000) throw new Error("toast probe never mounted")
    await app.renderOnce()
    await Bun.sleep(10)
  }
  return { app, toast: () => toast, cleanup: () => rootDir[Symbol.asyncDispose]() }
}

test("toasts stack newest last, cap at four, and dismiss individually", async () => {
  const { app, toast, cleanup } = await harness()
  try {
    await app.renderOnce()
    toast().show({ message: "first notice", variant: "info", duration: 60000 })
    toast().show({ message: "second notice", variant: "success", duration: 60000 })
    await app.renderOnce()
    let frame = app.captureCharFrame()
    expect(frame).toContain("first notice")
    expect(frame).toContain("second notice")
    expect(
      toast()
        .queue()
        .map((item) => item.message),
    ).toEqual(["first notice", "second notice"])

    toast().show({ message: "third notice", variant: "warning", duration: 60000 })
    toast().show({ message: "fourth notice", variant: "error", duration: 60000 })
    toast().show({ message: "fifth notice", variant: "info", duration: 60000 })
    expect(
      toast()
        .queue()
        .map((item) => item.message),
    ).toEqual(["second notice", "third notice", "fourth notice", "fifth notice"])

    toast().dismiss()
    expect(toast().queue().at(-1)?.message).toBe("fourth notice")
    toast().clear()
    expect(toast().queue()).toEqual([])
    await app.renderOnce()
    frame = app.captureCharFrame()
    expect(frame).not.toContain("fourth notice")
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})
