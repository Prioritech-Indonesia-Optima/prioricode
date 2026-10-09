import { Modifier } from "../types"
import type { InputEvent, KeyEventType, MouseEvent, NamedKey } from "../types"

export type InputParserOptions = Readonly<{ kittyFlags?: number }>

type ParserState = "idle" | "esc" | "ss3" | "csi" | "osc" | "dcs" | "paste"

type KeyMods = Readonly<{
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  super?: boolean
  hyper?: boolean
  eventKind?: KeyEventType
}>

const ESC = "\x1b"
const PASTE_END_SEQUENCE = "\x1b[201~"

const TILDE_KEYS: Record<number, string> = {
  1: "home",
  2: "insert",
  3: "delete",
  4: "end",
  5: "pageUp",
  6: "pageDown",
  7: "home",
  8: "end",
  11: "f1",
  12: "f2",
  13: "f3",
  14: "f4",
  15: "f5",
  17: "f6",
  18: "f7",
  19: "f8",
  20: "f9",
  21: "f10",
  23: "f11",
  24: "f12",
}

const CSI_FINAL_KEYS: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
}

const SS3_KEYS: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  P: "f1",
  Q: "f2",
  R: "f3",
  S: "f4",
}

const CONTROL_KEY_NAMES: Record<number, string> = {
  8: "backspace",
  9: "tab",
  10: "enter",
  13: "enter",
  27: "escape",
  127: "backspace",
}

const EVENT_KINDS: Record<number, KeyEventType> = { 1: "press", 2: "repeat", 3: "release" }

const WHEEL_TYPES = ["wheelUp", "wheelDown", "wheelLeft", "wheelRight"] as const

// Official kitty functional keycodes are 57344+ (PUA), not the 57312 range sketched in the brief.
const kittyBase: ReadonlyArray<readonly [number, NamedKey]> = [
  [57344, "escape"],
  [57345, "enter"],
  [57346, "tab"],
  [57347, "backspace"],
  [57348, "insert"],
  [57349, "delete"],
  [57350, "left"],
  [57351, "right"],
  [57352, "up"],
  [57353, "down"],
  [57354, "pageUp"],
  [57355, "pageDown"],
  [57356, "home"],
  [57357, "end"],
  [57358, "capsLock"],
  [57359, "scrollLock"],
  [57360, "numLock"],
  [57361, "printScreen"],
  [57362, "pause"],
  [57363, "menu"],
]

const kittyExtended: Array<readonly [number, string]> = []
for (let i = 0; i < 12; i++) kittyExtended.push([57364 + i, `f${i + 1}`])
for (let n = 13; n <= 35; n++) kittyExtended.push([57363 + n, `f${n}`])
for (let n = 0; n <= 9; n++) kittyExtended.push([57400 + n, `keypad${n}`])
kittyExtended.push(
  [57410, "keypadDecimal"],
  [57411, "keypadSeparator"],
  [57412, "keypadAdd"],
  [57413, "keypadSubtract"],
  [57414, "keypadMultiply"],
  [57415, "keypadDivide"],
  [57416, "keypadEnter"],
  [57417, "keypadEqual"],
  [57418, "keypadComma"],
)

const KITTY_FUNCTIONAL = new Map<number, string>([...kittyBase, ...kittyExtended])

function makeKey(name: string, sequence: string, mods: KeyMods = {}): Extract<InputEvent, { kind: "key" }> {
  return {
    kind: "key",
    name,
    sequence,
    raw: sequence,
    eventKind: mods.eventKind ?? "key",
    ctrl: mods.ctrl ?? false,
    alt: mods.alt ?? false,
    shift: mods.shift ?? false,
    meta: false,
    super: mods.super ?? false,
    hyper: mods.hyper ?? false,
  }
}

// KeyEvent has no capsLock/numLock fields, so mask bits 32/64 decode to nothing.
function applyMask(mask: number): KeyMods {
  return {
    shift: (mask & Modifier.Shift) !== 0,
    alt: (mask & Modifier.Alt) !== 0,
    ctrl: (mask & Modifier.Ctrl) !== 0,
    super: (mask & Modifier.Super) !== 0,
    hyper: (mask & Modifier.Hyper) !== 0,
  }
}

function ctrlName(code: number): string {
  return code === 0 ? "space" : String.fromCharCode(code + 0x40).toLowerCase()
}

function parsePrimary(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function parseOscBody(body: string): Readonly<{ code: number; data: string }> | undefined {
  const idx = body.indexOf(";")
  const codeText = idx < 0 ? body : body.slice(0, idx)
  if (codeText === "" || !/^\d+$/.test(codeText)) return undefined
  return { code: Number.parseInt(codeText, 10), data: idx < 0 ? "" : body.slice(idx + 1) }
}

function parseInnerOsc(data: string): Readonly<{ code: number; data: string }> | undefined {
  if (!data.startsWith(`${ESC}]`)) return undefined
  const body = data.slice(2)
  const bel = body.indexOf("\x07")
  const st = body.indexOf(`${ESC}\\`)
  const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st)
  if (end < 0) return undefined
  return parseOscBody(body.slice(0, end))
}

function kittyKeyName(codepoint: number): string {
  const functional = KITTY_FUNCTIONAL.get(codepoint)
  if (functional !== undefined) return functional
  if (codepoint >= 0xe000 && codepoint <= 0xf8ff) return `key${codepoint}`
  if (codepoint >= 0x20 && codepoint !== 0x7f) return String.fromCodePoint(codepoint)
  const control = CONTROL_KEY_NAMES[codepoint]
  return control ?? `key${codepoint}`
}

export function createInputParser(options: InputParserOptions = {}): Readonly<{
  feed(chunk: string): InputEvent[]
  flush(): InputEvent[]
  setKittyFlags(flags: number): void
  readonly bracketedPaste: boolean
}> {
  let kittyFlags = options.kittyFlags ?? 0
  let state: ParserState = "idle"
  let buf = ""
  let escPending = false
  let pendingSurrogate = ""
  let pasteBuf = ""
  let pasteScanFrom = 0
  let out: InputEvent[] = []

  const push = (event: InputEvent): void => {
    out.push(event)
  }

  const unknown = (data: string): void => {
    push({ kind: "unknown", data })
  }

  function pushControlOrText(ch: string, code: number): void {
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      push(makeKey(code === 0x09 ? "tab" : "enter", ch))
      return
    }
    if (code === 0x08 || code === 0x7f) {
      push(makeKey("backspace", ch))
      return
    }
    if (code < 0x20) {
      push(makeKey(ctrlName(code), ch, { ctrl: true }))
      return
    }
    push(makeKey(ch, ch))
  }

  function pushMeta(ch: string, code: number): void {
    if (code < 0x20) push(makeKey(ctrlName(code), ESC + ch, { ctrl: true, alt: true }))
    else push(makeKey(ch, ESC + ch, { alt: true }))
  }

  function pushLegacyKey(name: string, groups: string[], sequence: string): void {
    const mask = groups.length > 1 && groups[1] !== "" ? parsePrimary(groups[1].split(":")[0], 1) - 1 : 0
    push(makeKey(name, sequence, applyMask(mask)))
  }

  function dispatchCsi(final: string, params: string): void {
    state = "idle"
    const groups = params.split(";")
    const sequence = ESC + "[" + params + final
    if ((final === "M" || final === "m") && params.startsWith("<")) {
      dispatchMouse(sequence)
      return
    }
    if (final === "u") {
      dispatchCsiU(groups, sequence)
      return
    }
    if (final === "~") {
      const code = groups[0]
      if (code === "200") {
        state = "paste"
        pasteBuf = ""
        pasteScanFrom = 0
        return
      }
      if (code === "201") return
      const name = TILDE_KEYS[parsePrimary(code.split(":")[0], Number.NaN)]
      if (name !== undefined) {
        pushLegacyKey(name, groups, sequence)
        return
      }
      unknown(sequence)
      return
    }
    const letter = CSI_FINAL_KEYS[final]
    if (letter !== undefined) {
      pushLegacyKey(letter, groups, sequence)
      return
    }
    if ((final === "I" || final === "O") && params === "") {
      push({ kind: "focus", focused: final === "I" })
      return
    }
    if (final === "Z" && params === "") {
      push(makeKey("tab", sequence, { shift: true }))
      return
    }
    unknown(sequence)
  }

  function dispatchMouse(sequence: string): void {
    const params = sequence.slice(2, -1)
    const parts = params.slice(1).split(";")
    if (parts.length !== 3) {
      unknown(sequence)
      return
    }
    const button = parsePrimary(parts[0], Number.NaN)
    const x = parsePrimary(parts[1], Number.NaN)
    const y = parsePrimary(parts[2], Number.NaN)
    if (Number.isNaN(button) || Number.isNaN(x) || Number.isNaN(y)) {
      unknown(sequence)
      return
    }
    const index = button & 7
    let type: MouseEvent["type"]
    if ((button & 64) !== 0) type = WHEEL_TYPES[index]
    else if ((button & 32) !== 0) type = index === 3 ? "move" : "drag"
    else type = sequence.endsWith("M") ? "down" : "up"
    push({
      kind: "mouse",
      type,
      button: index,
      x: x - 1,
      y: y - 1,
      ctrl: (button & 16) !== 0,
      alt: (button & 8) !== 0,
      shift: (button & 4) !== 0,
    })
  }

  function dispatchCsiU(groups: string[], sequence: string): void {
    const codepoint = parsePrimary(groups[0]?.split(":")[0], Number.NaN)
    if (!Number.isFinite(codepoint)) {
      unknown(sequence)
      return
    }
    let mask = 0
    let eventKind: KeyEventType = "press"
    if (groups.length > 1 && groups[1] !== "") {
      const subs = groups[1].split(":")
      mask = parsePrimary(subs[0], 1) - 1
      // Press/repeat/release reporting is only meaningful once disambiguate (1) or report-events (2) is active.
      if (subs.length > 1 && ((kittyFlags & 1) !== 0 || (kittyFlags & 2) !== 0)) {
        eventKind = EVENT_KINDS[parsePrimary(subs[1], 1)] ?? "press"
      }
    }
    push(makeKey(kittyKeyName(codepoint), sequence, { ...applyMask(mask), eventKind }))
  }

  function finishOsc(): void {
    const parsed = parseOscBody(buf)
    if (parsed !== undefined) push({ kind: "osc", code: parsed.code, data: parsed.data })
    else unknown(ESC + "]" + buf)
    buf = ""
    state = "idle"
  }

  function finishDcs(): void {
    const idx = buf.indexOf(";")
    const prefix = idx < 0 ? buf : buf.slice(0, idx + 1)
    const data = idx < 0 ? "" : buf.slice(idx + 1)
    if (prefix.toLowerCase().startsWith("tmux;")) {
      const inner = parseInnerOsc(data)
      if (inner !== undefined) {
        push({ kind: "osc", code: inner.code, data: inner.data })
        buf = ""
        state = "idle"
        return
      }
    }
    push({ kind: "dcs", prefix, data })
    buf = ""
    state = "idle"
  }

  function feed(chunk: string): InputEvent[] {
    out = []
    let i = 0
    while (i < chunk.length) {
      if (state === "paste") {
        pasteBuf += chunk.slice(i)
        const idx = pasteBuf.indexOf(PASTE_END_SEQUENCE, pasteScanFrom)
        if (idx < 0) {
          pasteScanFrom = Math.max(0, pasteBuf.length - (PASTE_END_SEQUENCE.length - 1))
          break
        }
        push({ kind: "paste", text: pasteBuf.slice(0, idx) })
        const tail = pasteBuf.slice(idx + PASTE_END_SEQUENCE.length)
        pasteBuf = ""
        pasteScanFrom = 0
        state = "idle"
        i = chunk.length - tail.length
        continue
      }

      const ch = chunk[i]
      const code = chunk.charCodeAt(i)

      if (state === "idle") {
        if (pendingSurrogate !== "") {
          if (code >= 0xdc00 && code <= 0xdfff) {
            push(makeKey(pendingSurrogate + ch, pendingSurrogate + ch))
            pendingSurrogate = ""
            i++
            continue
          }
          push(makeKey(pendingSurrogate, pendingSurrogate))
          pendingSurrogate = ""
          continue
        }
        if (code === 0x1b) {
          state = "esc"
          i++
          continue
        }
        if (code >= 0xd800 && code <= 0xdbff) {
          pendingSurrogate = ch
          i++
          continue
        }
        pushControlOrText(ch, code)
        i++
        continue
      }

      if (state === "esc") {
        if (ch === "[") {
          state = "csi"
          buf = ""
          i++
          continue
        }
        if (ch === "]") {
          state = "osc"
          buf = ""
          escPending = false
          i++
          continue
        }
        if (ch === "P") {
          state = "dcs"
          buf = ""
          escPending = false
          i++
          continue
        }
        if (ch === "O") {
          state = "ss3"
          i++
          continue
        }
        if (code === 0x1b) {
          push(makeKey("escape", ESC))
          i++
          continue
        }
        pushMeta(ch, code)
        state = "idle"
        i++
        continue
      }

      if (state === "ss3") {
        const name = SS3_KEYS[ch]
        if (name !== undefined) push(makeKey(name, ESC + "O" + ch))
        else unknown(ESC + "O" + ch)
        state = "idle"
        i++
        continue
      }

      if (state === "csi") {
        if (code >= 0x30 && code <= 0x3f) {
          buf += ch
          i++
          continue
        }
        if (code === 0x1b) {
          unknown(ESC + "[" + buf)
          state = "esc"
          buf = ""
          i++
          continue
        }
        if (code >= 0x40 && code <= 0x7e) {
          dispatchCsi(ch, buf)
          buf = ""
          i++
          continue
        }
        unknown(ESC + "[" + buf)
        buf = ""
        state = "idle"
        continue
      }

      if (state === "osc") {
        if (escPending) {
          escPending = false
          if (ch === "\\") {
            finishOsc()
            i++
            continue
          }
          finishOsc()
          state = "esc"
          continue
        }
        if (code === 0x07) {
          finishOsc()
          i++
          continue
        }
        if (code === 0x1b) {
          escPending = true
          i++
          continue
        }
        buf += ch
        i++
        continue
      }

      // DCS: a doubled ESC collapses to a single literal ESC so ESC ESC \ never ends the string.
      if (state === "dcs") {
        if (escPending) {
          escPending = false
          if (ch === "\\") {
            finishDcs()
            i++
            continue
          }
          if (code === 0x1b) {
            buf += ESC
            i++
            continue
          }
          buf += ESC + ch
          i++
          continue
        }
        if (code === 0x1b) {
          escPending = true
          i++
          continue
        }
        buf += ch
        i++
        continue
      }

      i++
    }
    return out
  }

  function flush(): InputEvent[] {
    out = []
    if (pendingSurrogate !== "") {
      push(makeKey(pendingSurrogate, pendingSurrogate))
      pendingSurrogate = ""
    }
    switch (state) {
      case "esc":
        push(makeKey("escape", ESC))
        break
      case "ss3":
        unknown(ESC + "O")
        break
      case "csi":
        unknown(ESC + "[" + buf)
        break
      case "osc":
        unknown(ESC + "]" + buf + (escPending ? ESC : ""))
        break
      case "dcs":
        unknown(ESC + "P" + buf + (escPending ? ESC : ""))
        break
      case "paste":
        push({ kind: "paste", text: pasteBuf })
        break
      default:
        break
    }
    state = "idle"
    buf = ""
    escPending = false
    pasteBuf = ""
    pasteScanFrom = 0
    return out
  }

  return {
    feed,
    flush,
    setKittyFlags(flags: number): void {
      kittyFlags = flags
    },
    get bracketedPaste(): boolean {
      return state === "paste"
    },
  }
}
