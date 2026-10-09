import { expect, test } from "bun:test"
import { bindingMatchesEvent, createKeymap, parseBinding, parseBindings, type CommandDispatcher } from "../src/keymap"
import type { InputEvent, KeyEvent } from "../src/types"

function keyEvent(
  name: string,
  mods: Partial<Pick<KeyEvent, "ctrl" | "alt" | "shift" | "meta" | "eventKind">> = {},
): Extract<InputEvent, { kind: "key" }> {
  return {
    kind: "key",
    name,
    sequence: name,
    raw: name,
    eventKind: "press",
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    ...mods,
  }
}

function harness(dispatcher?: CommandDispatcher) {
  const hits: { name: string; event: KeyEvent | undefined }[] = []
  const km = createKeymap({
    dispatcher: dispatcher ?? ((name, event) => { hits.push({ name, event }); return true }),
  })
  return { km, hits }
}

test("parses binding strings into normalized strokes", () => {
  const [ctrlX] = parseBinding("ctrl+x")
  expect(ctrlX.name).toBe("ctrl+x")
  expect(ctrlX.seq).toBe("ctrl+x")
  expect(ctrlX.key).toBe("x")
  expect(ctrlX.ctrl).toBe(true)
  expect(ctrlX.eventKind).toBe("press")

  expect(parseBinding("shift+tab")[0].key).toBe("tab")
  expect(parseBinding("ctrl+alt+k")[0].name).toBe("ctrl+alt+k")
  expect(parseBinding("esc")[0].key).toBe("escape")
  expect(parseBinding("f12")[0].key).toBe("f12")
  expect(parseBinding("space")[0].key).toBe("space")
  expect(parseBinding("home")[0].key).toBe("home")
  expect(parseBinding("end")[0].key).toBe("end")
  expect(parseBinding("<")[0].key).toBe("<")
  expect(parseBinding(">")[0].key).toBe(">")

  expect(parseBinding("leader g s").map((b) => b.name)).toEqual(["leader", "g", "s"])
  expect(parseBindings(["ctrl+x", "leader g s"]).map((b) => b.name)).toEqual(["ctrl+x", "leader", "g", "s"])
  expect(parseBinding("enter:release")[0].eventKind).toBe("release")
})

test("uppercase letters imply shift", () => {
  const [shiftK] = parseBinding("K")
  expect(shiftK.key).toBe("k")
  expect(shiftK.shift).toBe(true)
  expect(shiftK.name).toBe("shift+k")
  expect(parseBinding("shift+ctrl+k")[0].name).toBe("ctrl+shift+k")
})

test("bindingMatchesEvent normalizes legacy uppercase text events", () => {
  expect(bindingMatchesEvent(parseBinding("shift+k")[0], keyEvent("K"))).toBe(true)
  expect(bindingMatchesEvent(parseBinding("shift+k")[0], keyEvent("k", { shift: true }))).toBe(true)
  expect(bindingMatchesEvent(parseBinding("k")[0], keyEvent("K"))).toBe(false)
  expect(bindingMatchesEvent(parseBinding("k")[0], keyEvent("k"))).toBe(true)
  expect(bindingMatchesEvent(parseBinding("ctrl+x")[0], keyEvent("x", { ctrl: true }))).toBe(true)
  expect(bindingMatchesEvent(parseBinding("space")[0], keyEvent(" "))).toBe(true)
  expect(bindingMatchesEvent(parseBinding("pageup")[0], keyEvent("pageUp"))).toBe(true)
  expect(bindingMatchesEvent(parseBinding("enter")[0], keyEvent("enter", { eventKind: "release" }))).toBe(false)
})

test("dispatches single-key bindings through the dispatcher", () => {
  const { km, hits } = harness()
  km.registerLayer({ id: "base", bindings: { "file.save": "ctrl+s" } })
  expect(km.dispatch(keyEvent("s", { ctrl: true }))).toBe(true)
  expect(hits).toEqual([{ name: "file.save", event: expect.objectContaining({ name: "s" }) }])
  expect(km.dispatch(keyEvent("s"))).toBe(false)
  expect(km.dispatch({ kind: "mouse", type: "down", button: 0, x: 0, y: 0, ctrl: false, alt: false, shift: false })).toBe(false)
})

test("highest-priority layer owns a command binding; ties favor earlier registration", () => {
  const { km, hits } = harness()
  km.registerLayer({ id: "low", priority: 1, bindings: { "cmd": "ctrl+x" } })
  km.registerLayer({ id: "high", priority: 10, bindings: { "cmd": "ctrl+y" } })
  expect(km.dispatch(keyEvent("x", { ctrl: true }))).toBe(false)
  expect(km.dispatch(keyEvent("y", { ctrl: true }))).toBe(true)
  expect(hits.map((h) => h.name)).toEqual(["cmd"])

  const second = harness()
  second.km.registerLayer({ id: "first", bindings: { "cmd": "ctrl+a" } })
  second.km.registerLayer({ id: "second", bindings: { "cmd": "ctrl+b" } })
  expect(second.km.dispatch(keyEvent("a", { ctrl: true }))).toBe(true)
  expect(second.km.dispatch(keyEvent("b", { ctrl: true }))).toBe(false)
})

test("false binding disables a command bound by a lower layer", () => {
  const { km } = harness()
  km.registerLayer({ id: "base", priority: 1, bindings: { "cmd": "ctrl+x" } })
  km.registerLayer({ id: "inhibit", priority: 10, bindings: { "cmd": false } })
  expect(km.dispatch(keyEvent("x", { ctrl: true }))).toBe(false)
})

test("leader chain advances and expires after the configured timeout", async () => {
  const { km, hits } = harness()
  km.registerLayer({ id: "base", bindings: { "git.status": "leader g s" } })
  km.leaderTimeoutMs(30)

  expect(await km.press("leader")).toBe(false)
  expect(km.pendingChain()).toEqual(["leader"])
  expect(km.dispatch(keyEvent("g"))).toBe(true)
  expect(km.pendingChain()).toEqual(["leader", "g"])
  expect(hits).toEqual([])

  await Bun.sleep(60)
  expect(km.pendingChain()).toEqual([])
  expect(km.dispatch(keyEvent("s"))).toBe(false)
})

test("chain mismatch clears pending and re-dispatches fresh; escape cancels", async () => {
  const { km, hits } = harness()
  km.registerLayer({ id: "base", bindings: { "git.status": "leader g s", "app.quit": "ctrl+q" } })

  await km.press("leader")
  expect(km.dispatch(keyEvent("q", { ctrl: true }))).toBe(true)
  expect(km.pendingChain()).toEqual([])
  expect(hits.map((h) => h.name)).toEqual(["app.quit"])

  await km.press("leader")
  expect(km.dispatch(keyEvent("escape"))).toBe(true)
  expect(km.pendingChain()).toEqual([])

  await km.press("leader")
  expect(km.dispatch(keyEvent("g"))).toBe(true)
  expect(km.dispatch(keyEvent("s"))).toBe(true)
  expect(km.pendingChain()).toEqual([])
  expect(hits.map((h) => h.name)).toEqual(["app.quit", "git.status"])
})

test("press dispatches a full nested chain by name", async () => {
  const { km, hits } = harness()
  km.registerLayer({ id: "base", bindings: { "git.status": "leader g s" } })
  expect(await km.press("leader g s")).toBe(true)
  expect(hits).toEqual([{ name: "git.status", event: undefined }])
  expect(await km.press("leader g x")).toBe(false)
  expect(await km.press("nope")).toBe(false)
})

test("uppercase shift bindings dispatch from legacy uppercase events", () => {
  const { km, hits } = harness()
  km.registerLayer({ id: "base", bindings: { "history.next": "shift+k" } })
  expect(km.dispatch(keyEvent("K"))).toBe(true)
  expect(km.dispatch(keyEvent("k", { shift: true }))).toBe(true)
  expect(hits.length).toBe(2)
})

test("disabled commands do not fire and are excluded from commands()", () => {
  const { km, hits } = harness()
  let enabled = false
  km.registerLayer({
    id: "base",
    commands: [{ name: "gated", enabled: () => enabled }],
    bindings: { "gated": "ctrl+g" },
  })
  expect(km.dispatch(keyEvent("g", { ctrl: true }))).toBe(false)
  expect(km.commands().map((c) => c.name)).toEqual([])
  enabled = true
  expect(km.dispatch(keyEvent("g", { ctrl: true }))).toBe(true)
  expect(hits.map((h) => h.name)).toEqual(["gated"])
  expect(km.commands().map((c) => c.name)).toEqual(["gated"])
})

test("mode gating filters layers via enabled()", () => {
  const { km, hits } = harness()
  km.registerLayer({
    id: "insert",
    bindings: { "input.mode.exit": "ctrl+[" },
    enabled: () => km.mode() === "insert",
  })
  expect(km.mode()).toBe("base")
  expect(km.dispatch(keyEvent("[", { ctrl: true }))).toBe(false)
  km.setMode("insert")
  expect(km.dispatch(keyEvent("[", { ctrl: true }))).toBe(true)
  km.setMode("base")
  expect(km.dispatch(keyEvent("[", { ctrl: true }))).toBe(false)
  expect(hits.map((h) => h.name)).toEqual(["input.mode.exit"])
})

test("commands() is sorted, deduped, and limited to enabled layers plus globals", () => {
  const { km } = harness()
  km.registerCommand({ name: "global.zulu" })
  km.registerCommand({ name: "global.alpha", suggested: true })
  km.registerLayer({ id: "off", enabled: () => false, commands: [{ name: "layer.off" }] })
  km.registerLayer({ id: "on", commands: [{ name: "layer.on" }, { name: "global.alpha", hidden: true }] })
  expect(km.commands().map((c) => c.name)).toEqual(["global.alpha", "global.zulu", "layer.on"])
})

test("unregister stops contributions and clears stale pending chains", async () => {
  const { km, hits } = harness()
  const off = km.registerLayer({ id: "temp", bindings: { "cmd": "ctrl+x k" } })
  expect(await km.press("ctrl+x")).toBe(false)
  expect(km.pendingChain()).toEqual(["ctrl+x"])
  off()
  expect(km.pendingChain()).toEqual([])
  expect(km.dispatch(keyEvent("x", { ctrl: true }))).toBe(false)
  expect(hits).toEqual([])
})

test("falls back to command onSelect when no dispatcher is configured", async () => {
  let fired = 0
  const km = createKeymap()
  km.registerCommand({ name: "picked", onSelect: () => { fired++ } })
  km.registerLayer({ id: "base", bindings: { "picked": "ctrl+p" } })
  expect(km.dispatch(keyEvent("p", { ctrl: true }))).toBe(true)
  expect(await km.press("ctrl+p")).toBe(true)
  expect(fired).toBe(2)
})
