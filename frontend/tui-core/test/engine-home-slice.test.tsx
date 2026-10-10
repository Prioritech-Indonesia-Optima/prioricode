// S8 seed: an app-shaped home slice (hero, prompt textarea with pinned
// status row using the exact flex discipline from the shipped fix) rendered
// through the compat layer + solid bridge, driven like the real terminal:
// focus, key events, paste, reactive hint. Proves the cut-over path.
/** @jsxImportSource @prioricode/tui-core/solid */
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { createCliRendererCore } from "../src/compat/cli"
import { mount } from "../src/solid/mount"
import { createKeymapFacade, registerEscapeClearsPendingSequence } from "../src/compat/keymap"
import { RGBA, TextAttributes, decodePasteBytes, MouseButton } from "../src/compat/core"
import type { KeyEvent } from "../src/types"

const key = (name: string, mods: Partial<Pick<KeyEvent, "ctrl" | "shift">> = {}): KeyEvent => ({
  name,
  sequence: name,
  raw: name,
  eventKind: "press",
  ctrl: mods.ctrl ?? false,
  alt: false,
  shift: mods.shift ?? false,
  meta: false,
})

test("home slice renders, accepts typing/paste, pins the status hint", async () => {
  const chunks: string[] = []
  const renderer: { terminal: { stop(): void } } & Record<string, unknown> = await createCliRendererCore({
    externalOutputMode: "capture-stdout",
    width: 60,
    height: 12,
    useMouse: true,
    write: (data) => void chunks.push(data),
  })
  const keymap = createKeymapFacade({ dispatcher: () => false })
  registerEscapeClearsPendingSequence(keymap)
  const [busy, setBusy] = createSignal(false)
  let textarea: { plainText: string } | undefined
  const app = await mount(
    () => (
      <box flexDirection="column" width="100%" height="100%">
        <text wrap="none" attributes={TextAttributes.BOLD}>
          PrioriCode — your terminal pair
        </text>
        <textarea
          width="100%"
          flexGrow={1}
          placeholder="ask for anything…"
          ref={(r: { plainText: string }) => (textarea = r)}
        />
        <box flexDirection="row" width="100%" flexShrink={0}>
          <box minWidth={0} flexShrink={1} overflow="hidden">
            <text flexShrink={0} wrapMode="none" fg={RGBA.fromHex("#ff0000")}>
              {busy() ? "esc again to interrupt" : "esc interrupt"}
            </text>
          </box>
        </box>
      </box>
    ),
    { device: { columns: 60, rows: 12, write: (data) => void chunks.push(data) } },
  )
  try {
    const frame = app.renderer.captureCharFrame()
    expect(frame).toContain("PrioriCode — your terminal pair")
    expect(frame).toContain("esc interrupt")
    expect(frame).toContain("ask for anything…")

    // focus the textarea through the renderer and drive input through it
    const findTextarea = (): { handleKey: (e: KeyEvent) => boolean } => {
      let found: { handleKey: (e: KeyEvent) => boolean } | undefined
      const walk = (n: RenderableLike) => {
        if (typeof (n as { handleKey?: unknown }).handleKey === "function") found = n as never
        for (const child of (n as { children?: RenderableLike[] }).children ?? []) walk(child)
      }
      walk(app.root as unknown as RenderableLike)
      if (!found) throw new Error("textarea not mounted")
      return found
    }
    type RenderableLike = { children?: unknown[] }
    const textAreaNode = findTextarea()
    app.renderer.focus(textAreaNode as never)
    for (const ch of "hello") expect(app.renderer.handleKey(key(ch))).toBe(true)
    app.renderer.renderNow()
    expect(app.renderer.captureCharFrame()).toContain("hello")

    app.renderer.handlePaste({ kind: "paste", text: decodePasteBytes(new Uint8Array([104, 105, 33])) })
    await Bun.sleep(20)
    app.renderer.renderNow()
    expect(app.renderer.captureCharFrame()).toContain("hi!")

    setBusy(true)
    app.renderer.renderNow()
    expect(app.renderer.captureCharFrame()).toContain("esc again to interrupt")

    // idle: no extra frames scheduled
    const before = app.renderer.frameCount
    await Bun.sleep(80)
    expect(app.renderer.frameCount).toBe(before)
    void MouseButton
    void chunks
  } finally {
    app.dispose()
    renderer.terminal.stop()
  }
})
