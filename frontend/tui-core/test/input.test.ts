import { expect, test } from "bun:test"
import { createTestRenderer } from "../src/testing/test-renderer"
import type { KeyEvent } from "../src/types"

const key = (name: string, mods: Partial<Pick<KeyEvent, "ctrl" | "alt" | "shift" | "meta">> = {}): KeyEvent => ({
  name,
  sequence: name,
  raw: name,
  eventKind: "press",
  ctrl: mods.ctrl ?? false,
  alt: mods.alt ?? false,
  shift: mods.shift ?? false,
  meta: mods.meta ?? false,
})

async function mountedInput(initial = "") {
  const app = await createTestRenderer({ width: 20, height: 3 })
  const input = app.input({ value: initial, placeholder: "type…" })
  input.restyle({ flexGrow: 1, height: 1 })
  app.root.addChild(input)
  app.renderer.renderNow()
  app.renderer.focus(input)
  return { app, input }
}

test("typing inserts and notifies onInput", async () => {
  const { app, input } = await mountedInput()
  const seen: string[] = []
  input.onInput = (value) => void seen.push(value)
  for (const ch of "abc") input.handleKey(key(ch))
  expect(input.value).toBe("abc")
  expect(seen).toEqual(["a", "ab", "abc"])
  app.renderer.renderNow()
  expect(app.charFrame()).toContain("abc")
  app.destroy()
})

test("arrows, home/end, and selection replacement", async () => {
  const { app, input } = await mountedInput("hello")
  input.handleKey(key("left"))
  input.handleKey(key("left"))
  input.handleKey(key("h")) // caret after "hel"
  expect(input.value).toBe("helhlo")
  input.setCursor(0)
  input.setCursor(4, true) // select "helh"
  input.handleKey(key("x"))
  expect(input.value).toBe("xlo")
  input.handleKey(key("home"))
  input.handleKey(key("end"))
  input.handleKey(key("y"))
  expect(input.value).toBe("xloy")
  app.destroy()
})

test("backspace respects grapheme clusters", async () => {
  const { app, input } = await mountedInput("aé😊b")
  input.setCursor(7) // before b
  input.handleKey(key("backspace"))
  expect(input.value).toBe("aé😊")
  input.handleKey(key("backspace"))
  expect(input.value).toBe("aé")
  input.handleKey(key("backspace"))
  expect(input.value).toBe("a")
  app.destroy()
})

test("ctrl+u clears before cursor, ctrl+w deletes word", async () => {
  const { app, input } = await mountedInput("delete word please")
  input.setCursor(18)
  input.handleKey(key("w", { ctrl: true }))
  expect(input.value).toBe("delete word ")
  input.handleKey(key("w", { ctrl: true }))
  expect(input.value).toBe("delete ")
  input.handleKey(key("u", { ctrl: true }))
  expect(input.value).toBe("")
  app.destroy()
})

test("enter commits and never inserts a newline", async () => {
  const { app, input } = await mountedInput("x")
  let commits = 0
  input.commit = () => void commits++
  input.handleKey(key("enter"))
  expect(commits).toBe(1)
  expect(input.value).toBe("x")
  app.destroy()
})

test("placeholder renders when empty and hides on type", async () => {
  const { app, input } = await mountedInput()
  expect(app.charFrame()).toContain("type…")
  input.handleKey(key("z"))
  app.renderer.renderNow()
  expect(app.charFrame()).toContain("z")
  expect(app.charFrame()).not.toContain("type…")
  app.destroy()
})

test("long values scroll horizontally around the cursor", async () => {
  const { app, input } = await mountedInput("0123456789abcdefghijklmnop")
  input.setCursor(26)
  app.renderer.renderNow()
  const line = app.charFrame().split("\n")[0]
  expect(line).toContain("p")
  expect(line).not.toContain("0123")
  input.setCursor(0)
  app.renderer.renderNow()
  expect(app.charFrame().split("\n")[0]).toContain("0123")
  app.destroy()
})

test("maxLength caps insertion", async () => {
  const app = await createTestRenderer({ width: 20, height: 3 })
  const input = app.input({ maxLength: 3 })
  input.restyle({ flexGrow: 1, height: 1 })
  app.root.addChild(input)
  app.renderer.renderNow()
  for (const ch of "abcdef") input.handleKey(key(ch))
  expect(input.value).toBe("abc")
  app.destroy()
})
