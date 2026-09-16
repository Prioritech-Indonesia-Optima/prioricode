/** @jsxImportSource @opentui/solid */
import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@prioricode/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { Global } from "@prioricode/core/global"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createEventSource, createFetch, directory } from "../../fixture/tui-sdk"

async function waitFrame(setup: Awaited<ReturnType<typeof createTestRenderer>>, needle: string) {
  return setup.waitForFrame((frame) => frame.includes(needle), { maxPasses: 300 })
}

test("opens the settings dialog with grouped rows", async () => {
  const setup = await createTestRenderer({ width: 120, height: 40, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let api: TuiPluginApi | undefined
  const saved: unknown[] = []

  try {
    const { run } = await import("../../../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        saveTuiConfig: async (patch) => {
          saved.push(patch)
        },
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )
    await ready
    await waitFrame(setup, "Connect a provider")

    api?.keymap.dispatchCommand("app.settings")
    await waitFrame(setup, "Settings")
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Model & Context")
    expect(frame).toContain("Compaction threshold")
    expect(frame).toContain("Fallback context window")
    expect(frame).toContain("Appearance")

    await setup.mockInput.typeText("mouse")
    await waitFrame(setup, "Mouse capture")
    setup.mockInput.pressEnter()
    await waitFrame(setup, "off")
    expect(saved).toEqual([{ mouse: false }])

    await setup.renderOnce()
    mock.restore()
    void task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})
