// Binding-string parsing and KeyEvent matching. A binding string is one
// whitespace-separated chain of strokes ("leader g s", "ctrl+x shift+tab");
// each stroke parses to one Binding with normalized modifier flags. A trailing
// ":release" (or ":press") suffix selects the key event kind to match.

import type { KeyEvent } from "../types"

export type Binding = Readonly<{
  name: string
  seq: string
  eventKind: "press" | "release"
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}>

const MODIFIER_TOKENS: Record<string, "ctrl" | "alt" | "shift" | "meta"> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  super: "meta",
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  escape: "escape",
  return: "enter",
  newline: "enter",
  enter: "enter",
  del: "delete",
  delete: "delete",
  bs: "backspace",
  backspace: "backspace",
  pgup: "pageup",
  pageup: "pageup",
  pgdn: "pagedown",
  pgdown: "pagedown",
  pagedown: "pagedown",
  spacebar: "space",
  space: "space",
  tab: "tab",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  home: "home",
  end: "end",
  insert: "insert",
}

const FUNCTION_KEY = /^f([1-9]|1[0-2])$/

export function normalizeKeyName(name: string): string {
  const lower = name.toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

function parseKeyToken(raw: string): Readonly<{ key: string; shift: boolean }> {
  const token = raw.trim()
  if (token === "") throw new Error(`invalid binding: empty key token`)
  if (token === " ") return { key: "space", shift: false }
  const lower = token.toLowerCase()
  const alias = KEY_ALIASES[lower]
  if (alias !== undefined) return { key: alias, shift: false }
  if (FUNCTION_KEY.test(lower)) return { key: lower, shift: false }
  if (token.length === 1) {
    // Uppercase letters imply shift; other single characters stay literal.
    if (lower !== token && lower >= "a" && lower <= "z") return { key: lower, shift: true }
    return { key: token, shift: false }
  }
  // Unknown multi-character tokens (for example "leader") stay as names.
  return { key: lower, shift: false }
}

function parseStroke(input: string): Binding {
  let text = input.trim()
  let eventKind: Binding["eventKind"] = "press"
  const suffix = /^(.*?):(press|release)$/i.exec(text)
  if (suffix?.[1] !== undefined && suffix[1] !== "") {
    text = suffix[1]
    eventKind = suffix[2].toLowerCase() as Binding["eventKind"]
  }
  const tokens = text.split("+")
  const keyToken = tokens[tokens.length - 1] ?? ""
  const mods = { ctrl: false, alt: false, shift: false, meta: false }
  for (const token of tokens.slice(0, -1)) {
    const mod = MODIFIER_TOKENS[token.trim().toLowerCase()]
    if (mod === undefined) throw new Error(`invalid binding modifier: ${token}`)
    mods[mod] = true
  }
  const parsed = parseKeyToken(keyToken)
  mods.shift = mods.shift || parsed.shift
  const prefix: string[] = []
  if (mods.ctrl) prefix.push("ctrl")
  if (mods.alt) prefix.push("alt")
  if (mods.shift) prefix.push("shift")
  if (mods.meta) prefix.push("meta")
  const name = [...prefix, parsed.key].join("+")
  return Object.freeze({
    name,
    seq: name,
    eventKind,
    ctrl: mods.ctrl,
    alt: mods.alt,
    shift: mods.shift,
    meta: mods.meta,
    key: parsed.key,
  })
}

export function parseBinding(seq: string): Binding[] {
  return seq
    .split(/\s+/)
    .filter((part) => part !== "")
    .map(parseStroke)
}

export function parseBindings(input: string | string[]): Binding[] {
  const parts = typeof input === "string" ? [input] : input
  return parts.flatMap(parseBinding)
}

export function bindingMatchesEvent(b: Binding, e: KeyEvent): boolean {
  const release = e.eventKind === "release"
  if (release !== (b.eventKind === "release")) return false
  if (e.ctrl !== b.ctrl) return false
  if (e.alt !== b.alt) return false
  const meta = e.meta || e.super === true || e.hyper === true
  if (meta !== b.meta) return false
  const key = e.name === " " ? "space" : normalizeKeyName(e.name)
  // Legacy text events report shift+letter as an uppercase name with shift
  // unset, so an uppercase single-letter name counts as the shift modifier.
  const shift = e.shift || /^[A-Z]$/.test(e.name)
  if (shift !== b.shift) return false
  return key === b.key
}
