import { expect, test } from "bun:test"
import { createTestRenderer } from "../src/testing/test-renderer"
import { computeVisualLines, EditorView } from "../src/text/editor-view"
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

async function mountedTextarea(props: Parameters<typeof createTestRenderer>[0] extends never ? never : object = {}) {
  const app = await createTestRenderer({ width: 20, height: 6 })
  const area = app.textarea({ ...props })
  area.restyle({ width: 20, height: 4 })
  app.root.addChild(area)
  app.renderer.renderNow()
  app.renderer.focus(area)
  return { app, area }
}

test("visual wrapping is contiguous and word-aware", () => {
  const text = "alpha beta gamma"
  const lines = computeVisualLines(text, 10)
  expect(lines.map((l) => text.slice(l.start, l.end))).toEqual(["alpha ", "beta gamma"])
  expect(lines[1]!.start).toBe(lines[0]!.end)
  const hard = "abcdefghij klmno"
  const single = computeVisualLines(hard, 5)
  const rebuilt = single.map((l) => hard.slice(l.start, l.end)).join("")
  expect(rebuilt).toBe(hard)
  const view = new EditorView(single)
  view.setSource(hard)
  expect(view.positionOf(0).row).toBe(0)
  expect(view.positionOf(12).row).toBe(2)
})

test("empty textarea renders placeholder", async () => {
  const { app, area } = await mountedTextarea({ placeholder: "ask anything…", placeholderColor: 0x808080 })
  app.renderer.renderNow()
  expect(app.charFrame()).toContain("ask anything…")
  area.insertText("hi")
  app.renderer.renderNow()
  expect(app.charFrame()).toContain("hi")
  expect(app.charFrame()).not.toContain("ask anything")
  app.destroy()
})

test("multiline editing with arrow navigation across wrapped rows", async () => {
  const { app, area } = await mountedTextarea()
  area.insertText("one\ntwo\nthree")
  expect(area.plainText).toBe("one\ntwo\nthree")
  area.gotoBufferEnd()
  area.handleKey(key("up"))
  expect(area.plainText.slice(area.cursorOffset - 3, area.cursorOffset)).toBe("two")
  area.handleKey(key("home"))
  expect(area.visualCursor.col).toBe(0)
  area.handleKey(key("end"))
  expect(area.plainText.slice(area.cursorOffset - 3, area.cursorOffset)).toBe("two")
  app.destroy()
})

test("wrap mapping: visual rows for a long paragraph", async () => {
  const { app, area } = await mountedTextarea()
  area.insertText("aaaaaaaa bbbbbbbb cccccccc")
  expect(area.editorView.getTotalVirtualLineCount()).toBe(2)
  area.cursorOffset = 0
  expect(area.visualCursor.visualRow).toBe(0)
  area.cursorOffset = 20
  expect(area.visualCursor.visualRow).toBe(1)
  area.cursorOffset = 25
  expect(area.visualCursor.visualRow).toBe(1)
  app.destroy()
})

test("chips: extmark spans style painting and delete atomically", async () => {
  const { app, area } = await mountedTextarea()
  const type = area.extmarks.registerType("prompt-part")
  area.insertText("see @img.png now")
  const start = area.plainText.indexOf("@img.png")
  const id = area.extmarks.create({ start, end: start + 8, typeId: type, virtual: true })
  area.styleForId = () => ({ fg: 0x00ff00 })
  area.cursorOffset = start + 8
  area.handleKey(key("backspace"))
  expect(area.plainText).toBe("see  now")
  expect(area.extmarks.all().length).toBe(0)
  void id
  app.destroy()
})

test("typing before a chip pushes it, typing inside keeps text styled", async () => {
  const { app, area } = await mountedTextarea()
  const type = area.extmarks.registerType("prompt-part")
  area.insertText("@chip rest")
  const id = area.extmarks.create({ start: 0, end: 5, typeId: type })
  area.cursorOffset = 0
  area.insertText("X")
  const mark = area.extmarks.get(id)!
  expect([mark.start, mark.end]).toEqual([1, 6])
  expect(area.plainText).toBe("X@chip rest")
  app.destroy()
})

test("enter calls onSubmit instead of inserting a newline", async () => {
  const { app, area } = await mountedTextarea()
  let submits = 0
  area.onSubmit = () => void submits++
  area.insertText("ready")
  area.handleKey(key("enter"))
  expect(submits).toBe(1)
  expect(area.plainText).toBe("ready")
  app.destroy()
})

test("onContentChange and onCursorChange fire", async () => {
  const { app, area } = await mountedTextarea()
  let content = 0
  let cursor = 0
  area.onContentChange = () => void content++
  area.onCursorChange = () => void cursor++
  area.handleKey(key("a"))
  area.cursorOffset = 0
  expect(content).toBeGreaterThanOrEqual(1)
  expect(cursor).toBeGreaterThanOrEqual(2)
  app.destroy()
})

test("traits.capture defers keys to the host keymap", async () => {
  const { app, area } = await mountedTextarea()
  area.insertText("x")
  area.traits = { capture: ["tab"] }
  expect(area.handleKey(key("tab"))).toBe(false)
  expect(area.plainText).toBe("x")
  area.traits = {}
  expect(area.handleKey(key("tab"))).toBe(true)
  expect(area.plainText).toBe("x    ")
  app.destroy()
})

test("scroll keeps the cursor line visible", async () => {
  const { app, area } = await mountedTextarea()
  area.insertText(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"))
  area.cursorOffset = area.plainText.length
  expect(area.scrollY + 4).toBeGreaterThanOrEqual(area.visualCursor.visualRow + 1)
  area.cursorOffset = 0
  expect(area.scrollY).toBe(0)
  app.destroy()
})

test("terminal cursor position is emitted for the focused textarea", async () => {
  const { app, area } = await mountedTextarea()
  area.insertText("abc")
  app.renderer.renderNow()
  const output = app.output()
  expect(area.cursorPosition?.x).toBe(3)
  expect(area.cursorPosition?.y).toBe(0)
  expect(output).toContain("\x1b[1;4H\x1b[?25h")
  app.renderer.focus(undefined)
  app.renderer.renderNow()
  expect(app.output()).toContain("\x1b[?25l")
  app.destroy()
})

test("paste routes through onPaste with preventDefault honored", async () => {
  const { app, area } = await mountedTextarea()
  let saw: string | undefined
  area.onPaste = async (event) => {
    saw = event.text
    event.preventDefault()
  }
  await area.handlePaste({ text: "pasted\ncontent", bytes: new Uint8Array(), preventDefault: () => {} })
  expect(saw).toBe("pasted\ncontent")
  expect(area.plainText).toBe("")
  area.onPaste = undefined
  await area.handlePaste({ text: "x\r\ny", bytes: new Uint8Array(), preventDefault: () => {} })
  expect(area.plainText).toBe("x\ny")
  app.destroy()
})
