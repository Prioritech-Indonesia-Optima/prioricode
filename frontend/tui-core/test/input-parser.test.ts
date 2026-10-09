import { expect, test } from "bun:test"
import { createInputParser } from "../src/io/parser"
import { createOscChannel, encodeDcsPassthrough, encodeOsc } from "../src/io/osc"
import type { InputEvent } from "../src/types"

type KeyEv = Extract<InputEvent, { kind: "key" }>
type MouseEv = Extract<InputEvent, { kind: "mouse" }>

function keyOf(ev: InputEvent | undefined): KeyEv {
  if (ev === undefined || ev.kind !== "key") throw new Error(`expected key event, got ${JSON.stringify(ev)}`)
  return ev
}

function mouseOf(ev: InputEvent | undefined): MouseEv {
  if (ev === undefined || ev.kind !== "mouse") throw new Error(`expected mouse event, got ${JSON.stringify(ev)}`)
  return ev
}

function single(events: InputEvent[]): InputEvent {
  expect(events.length).toBe(1)
  return events[0]
}

test("plain text emits one key event per character", () => {
  const events = createInputParser().feed("ab")
  expect(events.length).toBe(2)
  const a = keyOf(events[0])
  expect(a.name).toBe("a")
  expect(a.sequence).toBe("a")
  expect(a.raw).toBe("a")
  expect(a.eventKind).toBe("key")
  expect(a.ctrl).toBe(false)
  expect(a.alt).toBe(false)
  expect(a.shift).toBe(false)
  expect(a.meta).toBe(false)
  expect(keyOf(events[1]).name).toBe("b")
})

test("astral character inside one chunk", () => {
  const a = keyOf(single(createInputParser().feed("😀")))
  expect(a.name).toBe("😀")
})

test("multibyte codepoint split across chunks accumulates", () => {
  const parser = createInputParser()
  expect(parser.feed("\ud83d").length).toBe(0)
  const a = keyOf(single(parser.feed("\ude00")))
  expect(a.name).toBe("😀")
})

test("orphan high surrogate settles on flush", () => {
  const parser = createInputParser()
  parser.feed("\ud83d")
  expect(keyOf(single(parser.flush())).name).toBe("\ud83d")
})

test("CR LF TAB BS DEL map to named keys", () => {
  const parser = createInputParser()
  expect(keyOf(single(parser.feed("\r"))).name).toBe("enter")
  expect(keyOf(single(parser.feed("\n"))).name).toBe("enter")
  expect(keyOf(single(parser.feed("\t"))).name).toBe("tab")
  expect(keyOf(single(parser.feed("\x08"))).name).toBe("backspace")
  const del = keyOf(single(parser.feed("\x7f")))
  expect(del.name).toBe("backspace")
  expect(del.raw).toBe("\x7f")
})

test("legacy ctrl bytes decode as ctrl+letter", () => {
  const parser = createInputParser()
  const a = keyOf(single(parser.feed("\x01")))
  expect(a.name).toBe("a")
  expect(a.ctrl).toBe(true)
  expect(a.alt).toBe(false)
  const z = keyOf(single(parser.feed("\x1a")))
  expect(z.name).toBe("z")
  expect(z.ctrl).toBe(true)
})

test("lone ESC buffers and flushes as escape key", () => {
  const parser = createInputParser()
  expect(parser.feed("\x1b").length).toBe(0)
  const esc = keyOf(single(parser.flush()))
  expect(esc.name).toBe("escape")
  expect(esc.sequence).toBe("\x1b")
})

test("ESC followed by ESC emits escape then re-arms", () => {
  const events = createInputParser().feed("\x1b\x1b[A")
  expect(events.length).toBe(2)
  expect(keyOf(events[0]).name).toBe("escape")
  expect(keyOf(events[1]).name).toBe("up")
})

test("ESC + printable is alt+char", () => {
  const x = keyOf(single(createInputParser().feed("\x1bx")))
  expect(x.name).toBe("x")
  expect(x.alt).toBe(true)
  expect(x.ctrl).toBe(false)
  expect(x.sequence).toBe("\x1bx")
})

test("arrows and application-mode variants", () => {
  const parser = createInputParser()
  const map: Array<[string, string]> = [
    ["\x1b[A", "up"],
    ["\x1b[B", "down"],
    ["\x1b[C", "right"],
    ["\x1b[D", "left"],
    ["\x1bOA", "up"],
    ["\x1bOB", "down"],
    ["\x1bOC", "right"],
    ["\x1bOD", "left"],
  ]
  for (const [bytes, name] of map) {
    const ev = keyOf(single(parser.feed(bytes)))
    expect(ev.name).toBe(name)
    expect(ev.eventKind).toBe("key")
  }
})

test("home and end across all encodings", () => {
  const parser = createInputParser()
  expect(keyOf(single(parser.feed("\x1b[H"))).name).toBe("home")
  expect(keyOf(single(parser.feed("\x1b[F"))).name).toBe("end")
  expect(keyOf(single(parser.feed("\x1bOH"))).name).toBe("home")
  expect(keyOf(single(parser.feed("\x1bOF"))).name).toBe("end")
  expect(keyOf(single(parser.feed("\x1b[1~"))).name).toBe("home")
  expect(keyOf(single(parser.feed("\x1b[4~"))).name).toBe("end")
  expect(keyOf(single(parser.feed("\x1b[7~"))).name).toBe("home")
  expect(keyOf(single(parser.feed("\x1b[8~"))).name).toBe("end")
})

test("tilde edits and page keys", () => {
  const parser = createInputParser()
  expect(keyOf(single(parser.feed("\x1b[2~"))).name).toBe("insert")
  expect(keyOf(single(parser.feed("\x1b[3~"))).name).toBe("delete")
  expect(keyOf(single(parser.feed("\x1b[5~"))).name).toBe("pageUp")
  expect(keyOf(single(parser.feed("\x1b[6~"))).name).toBe("pageDown")
})

test("F1-F4 SS3 and F5-F12 tilde codes", () => {
  const parser = createInputParser()
  expect(keyOf(single(parser.feed("\x1bOP"))).name).toBe("f1")
  expect(keyOf(single(parser.feed("\x1bOQ"))).name).toBe("f2")
  expect(keyOf(single(parser.feed("\x1bOR"))).name).toBe("f3")
  expect(keyOf(single(parser.feed("\x1bOS"))).name).toBe("f4")
  expect(keyOf(single(parser.feed("\x1b[15~"))).name).toBe("f5")
  expect(keyOf(single(parser.feed("\x1b[17~"))).name).toBe("f6")
  expect(keyOf(single(parser.feed("\x1b[21~"))).name).toBe("f10")
  expect(keyOf(single(parser.feed("\x1b[23~"))).name).toBe("f11")
  expect(keyOf(single(parser.feed("\x1b[24~"))).name).toBe("f12")
})

test("legacy modifier parameters", () => {
  const ctrlRight = keyOf(single(createInputParser().feed("\x1b[1;5C")))
  expect(ctrlRight.name).toBe("right")
  expect(ctrlRight.ctrl).toBe(true)
  expect(ctrlRight.sequence).toBe("\x1b[1;5C")
  const ctrlDelete = keyOf(single(createInputParser().feed("\x1b[3;5~")))
  expect(ctrlDelete.name).toBe("delete")
  expect(ctrlDelete.ctrl).toBe(true)
  const shiftPageUp = keyOf(single(createInputParser().feed("\x1b[5;2~")))
  expect(shiftPageUp.shift).toBe(true)
})

test("sequences split across chunks complete lazily", () => {
  const parser = createInputParser()
  expect(parser.feed("\x1b[").length).toBe(0)
  expect(parser.feed("3;").length).toBe(0)
  const deleteCtrl = keyOf(single(parser.feed("5~")))
  expect(deleteCtrl.name).toBe("delete")
  expect(deleteCtrl.ctrl).toBe(true)
  expect(parser.feed("\x1b").length).toBe(0)
  expect(parser.feed("[").length).toBe(0)
  expect(keyOf(single(parser.feed("A"))).name).toBe("up")
})

test("kitty CSI u press and modifiers", () => {
  const parser = createInputParser()
  const plain = keyOf(single(parser.feed("\x1b[97u")))
  expect(plain.name).toBe("a")
  expect(plain.eventKind).toBe("press")
  expect(plain.ctrl).toBe(false)
  const ctrl = keyOf(single(parser.feed("\x1b[97;5u")))
  expect(ctrl.name).toBe("a")
  expect(ctrl.ctrl).toBe(true)
  expect(ctrl.eventKind).toBe("press")
  const shifted = keyOf(single(parser.feed("\x1b[65;2u")))
  expect(shifted.name).toBe("A")
  expect(shifted.shift).toBe(true)
})

test("kitty functional codepoints map to NamedKey names", () => {
  const parser = createInputParser()
  expect(keyOf(single(parser.feed("\x1b[57344u"))).name).toBe("escape")
  expect(keyOf(single(parser.feed("\x1b[57345u"))).name).toBe("enter")
  expect(keyOf(single(parser.feed("\x1b[57347u"))).name).toBe("backspace")
  expect(keyOf(single(parser.feed("\x1b[57358u"))).name).toBe("capsLock")
  expect(keyOf(single(parser.feed("\x1b[57363u"))).name).toBe("menu")
  expect(keyOf(single(parser.feed("\x1b[57364u"))).name).toBe("f1")
  expect(keyOf(single(parser.feed("\x1b[57375u"))).name).toBe("f12")
  expect(keyOf(single(parser.feed("\x1b[57400u"))).name).toBe("keypad0")
  expect(keyOf(single(parser.feed("\x1b[57409u"))).name).toBe("keypad9")
  expect(keyOf(single(parser.feed("\x1b[60000u"))).name).toBe("key60000")
})

test("kitty event kinds require extended flags", () => {
  const plain = createInputParser()
  const ignored = keyOf(single(plain.feed("\x1b[98;2:2u")))
  expect(ignored.eventKind).toBe("press")
  expect(ignored.shift).toBe(true)

  const parser = createInputParser({ kittyFlags: 3 })
  const repeat = keyOf(single(parser.feed("\x1b[98;2:2u")))
  expect(repeat.eventKind).toBe("repeat")
  const release = keyOf(single(parser.feed("\x1b[98;2:3u")))
  expect(release.eventKind).toBe("release")
  expect(release.shift).toBe(true)
  parser.setKittyFlags(0)
  expect(keyOf(single(parser.feed("\x1b[98;2:3u"))).eventKind).toBe("press")
})

test("kitty flags can be enabled mid-stream", () => {
  const parser = createInputParser()
  parser.setKittyFlags(1)
  expect(keyOf(single(parser.feed("\x1b[99;1:1u"))).eventKind).toBe("press")
  expect(keyOf(single(parser.feed("\x1b[99;1:3u"))).eventKind).toBe("release")
})

test("CSI u split across chunks", () => {
  const parser = createInputParser()
  expect(parser.feed("\x1b[9").length).toBe(0)
  expect(keyOf(single(parser.feed("7;5u"))).ctrl).toBe(true)
})

test("SGR mouse press release move drag", () => {
  const parser = createInputParser()
  const down = mouseOf(single(parser.feed("\x1b[<0;13;5M")))
  expect(down.type).toBe("down")
  expect(down.button).toBe(0)
  expect(down.x).toBe(12)
  expect(down.y).toBe(4)
  const up = mouseOf(single(parser.feed("\x1b[<3;1;1m")))
  expect(up.type).toBe("up")
  expect(up.button).toBe(3)
  const move = mouseOf(single(parser.feed("\x1b[<35;4;7M")))
  expect(move.type).toBe("move")
  expect(move.button).toBe(3)
  parser.feed("\x1b[<35;4;7M")
  const drag = mouseOf(single(parser.feed("\x1b[<33;4;7M")))
  expect(drag.type).toBe("drag")
  expect(drag.button).toBe(1)
})

test("SGR mouse wheel directions and modifiers", () => {
  const parser = createInputParser()
  expect(mouseOf(single(parser.feed("\x1b[<64;2;2M"))).type).toBe("wheelUp")
  expect(mouseOf(single(parser.feed("\x1b[<65;2;2M"))).type).toBe("wheelDown")
  expect(mouseOf(single(parser.feed("\x1b[<66;2;2M"))).type).toBe("wheelLeft")
  expect(mouseOf(single(parser.feed("\x1b[<67;2;2M"))).type).toBe("wheelRight")
  const ctrlShift = mouseOf(single(parser.feed("\x1b[<20;3;4M")))
  expect(ctrlShift.ctrl).toBe(true)
  expect(ctrlShift.shift).toBe(true)
  expect(ctrlShift.alt).toBe(false)
  const alt = mouseOf(single(parser.feed("\x1b[<8;3;4M")))
  expect(alt.alt).toBe(true)
})

test("SGR mouse split across chunks", () => {
  const parser = createInputParser()
  expect(parser.feed("\x1b[<0;1").length).toBe(0)
  expect(mouseOf(single(parser.feed("2;3M"))).x).toBe(11)
})

test("bracketed paste captures raw text including ESC", () => {
  const parser = createInputParser()
  expect(parser.bracketedPaste).toBe(false)
  expect(parser.feed("\x1b[200~he").length).toBe(0)
  expect(parser.bracketedPaste).toBe(true)
  const events = parser.feed("llo\x1b[201~")
  const paste = single(events)
  expect(paste.kind).toBe("paste")
  expect(paste.kind === "paste" && paste.text).toBe("hello")
  expect(parser.bracketedPaste).toBe(false)
})

test("paste preserves embedded escape sequences literally", () => {
  const parser = createInputParser()
  const paste = single(parser.feed("\x1b[200~a\x1bb[3~\x1b[201~"))
  expect(paste.kind === "paste" && paste.text).toBe("a\x1bb[3~")
})

test("paste terminator split across chunks and trailing input continues", () => {
  const parser = createInputParser()
  parser.feed("\x1b[200~x\x1b[20")
  const events = parser.feed("1~y")
  expect(events.length).toBe(2)
  expect(events[0].kind === "paste" && events[0].text).toBe("x")
  expect(keyOf(events[1]).name).toBe("y")
})

test("flush closes an unterminated paste as a paste event", () => {
  const parser = createInputParser()
  parser.feed("\x1b[200~abc")
  const paste = single(parser.flush())
  expect(paste.kind === "paste" && paste.text).toBe("abc")
  expect(parser.bracketedPaste).toBe(false)
})

test("focus in and out", () => {
  const parser = createInputParser()
  const inEv = parser.feed("\x1b[I")[0]
  expect(inEv !== undefined && inEv.kind === "focus" && inEv.focused).toBe(true)
  const outEv = parser.feed("\x1b[O")[0]
  expect(outEv !== undefined && outEv.kind === "focus" && outEv.focused).toBe(false)
})

test("OSC with BEL and ST terminators", () => {
  const parser = createInputParser()
  const bel = parser.feed("\x1b]5522;type=read:status=OK\x07")[0]
  expect(bel !== undefined && bel.kind === "osc" && bel.code).toBe(5522)
  expect(bel !== undefined && bel.kind === "osc" && bel.data).toBe("type=read:status=OK")
  const st = parser.feed("\x1b]0;my title\x1b\\")[0]
  expect(st !== undefined && st.kind === "osc" && st.code).toBe(0)
  expect(st !== undefined && st.kind === "osc" && st.data).toBe("my title")
})

test("OSC split across chunks", () => {
  const parser = createInputParser()
  expect(parser.feed("\x1b]52;abc").length).toBe(0)
  const ev = single(parser.feed("def\x07"))
  expect(ev.kind === "osc" && ev.code).toBe(52)
  expect(ev.kind === "osc" && ev.data).toBe("abcdef")
})

test("OSC with non-numeric code falls back to unknown on flush", () => {
  const parser = createInputParser()
  const ev = single(parser.feed("\x1b]oops\x07"))
  expect(ev.kind).toBe("unknown")
  expect(ev.kind === "unknown" && ev.data).toBe("\x1b]oops")
})

test("generic DCS yields prefix and data", () => {
  const parser = createInputParser()
  const ev = single(parser.feed("\x1bPq;abc=1;2\x1b\\"))
  expect(ev.kind === "dcs" && ev.prefix).toBe("q;")
  expect(ev.kind === "dcs" && ev.data).toBe("abc=1;2")
})

test("tmux DCS passthrough unwraps to OSC 5522", () => {
  const parser = createInputParser()
  const wrapped = encodeDcsPassthrough("\x1b]5522;type=read:status=OK:id=x\x07")
  const ev = single(parser.feed(wrapped))
  expect(ev.kind === "osc" && ev.code).toBe(5522)
  expect(ev.kind === "osc" && ev.data).toBe("type=read:status=OK:id=x")
})

test("tmux passthrough with doubled ST terminator inside the payload", () => {
  const parser = createInputParser()
  const ev = single(parser.feed(encodeDcsPassthrough("\x1b]52;abc\x1b\\")))
  expect(ev.kind === "osc" && ev.code).toBe(52)
  expect(ev.kind === "osc" && ev.data).toBe("abc")
})

test("tmux DCS without inner OSC stays a DCS event with unwrapped data", () => {
  const parser = createInputParser()
  const ev = single(parser.feed("\x1bPtmux;\x1b\x1bcmd\x1b\\"))
  expect(ev.kind === "dcs" && ev.prefix).toBe("tmux;")
  expect(ev.kind === "dcs" && ev.data).toBe("\x1bcmd")
})

test("DCS split across chunks", () => {
  const parser = createInputParser()
  expect(parser.feed("\x1bPq;ab").length).toBe(0)
  const ev = single(parser.feed("c\x1b\\"))
  expect(ev.kind === "dcs" && ev.data).toBe("abc")
})

test("flush emits unknown for every incomplete sequence family", () => {
  const cases: Array<[string, string]> = [
    ["\x1b[1;2", "\x1b[1;2"],
    ["\x1b]52;ab", "\x1b]52;ab"],
    ["\x1bPxx", "\x1bPxx"],
    ["\x1bO", "\x1bO"],
  ]
  for (const [input, data] of cases) {
    const parser = createInputParser()
    parser.feed(input)
    const ev = single(parser.flush())
    expect(ev.kind).toBe("unknown")
    expect(ev.kind === "unknown" && ev.data).toBe(data)
  }
})

test("invalid byte inside CSI flushes unknown and reprocesses the byte", () => {
  const events = createInputParser().feed("\x1b[1;2\x01")
  expect(events.length).toBe(2)
  expect(events[0].kind === "unknown" && events[0].data).toBe("\x1b[1;2")
  const a = keyOf(events[1])
  expect(a.name).toBe("a")
  expect(a.ctrl).toBe(true)
})

test("ESC cancels a buffered CSI", () => {
  const parser = createInputParser()
  const events = parser.feed("\x1b[1;2\x1bOP")
  expect(events.length).toBe(2)
  expect(events[0].kind).toBe("unknown")
  expect(keyOf(events[1]).name).toBe("f1")
})

test("unknown tilde code reports unknown with raw sequence", () => {
  const ev = single(createInputParser().feed("\x1b[999~"))
  expect(ev.kind === "unknown" && ev.data).toBe("\x1b[999~")
})

test("encodeOsc round-trips through the parser", () => {
  const parser = createInputParser()
  const bel = single(parser.feed(encodeOsc(5522, "type=read:status=OK:id=x")))
  expect(bel.kind === "osc" && bel.code).toBe(5522)
  expect(bel.kind === "osc" && bel.data).toBe("type=read:status=OK:id=x")
  const st = single(parser.feed(encodeOsc(5522, "a=1", "st")))
  expect(st.kind === "osc" && st.data).toBe("a=1")
  expect(encodeOsc(0, "t")).toBe("\x1b]0;t\x07")
})

test("osc channel routes by code and supports unsubscribe", () => {
  const channel = createOscChannel()
  const parser = createInputParser()
  const received: string[] = []
  const unsubscribe = channel.on(5522, (data) => received.push(data))
  channel.feed(parser.feed(encodeOsc(5522, "type=read:status=OK:id=x"))[0] as Extract<InputEvent, { kind: "osc" } | { kind: "dcs" }>)
  expect(received).toEqual(["type=read:status=OK:id=x"])
  unsubscribe()
  channel.feed(parser.feed(encodeOsc(5522, "late"))[0] as Extract<InputEvent, { kind: "osc" } | { kind: "dcs" }>)
  expect(received.length).toBe(1)
})

test("dcs channel handler receives prefix and data", () => {
  const channel = createOscChannel()
  const calls: Array<[string, string]> = []
  const off = channel.onDcs((prefix, data) => calls.push([prefix, data]))
  channel.feed({ kind: "dcs", prefix: "tmux;", data: "raw" })
  expect(calls).toEqual([["tmux;", "raw"]])
  off()
  channel.feed({ kind: "dcs", prefix: "q;", data: "x" })
  expect(calls.length).toBe(1)
})

test("osc channel ignores unregistered codes", () => {
  const channel = createOscChannel()
  let hit = false
  channel.on(52, () => {
    hit = true
  })
  channel.feed({ kind: "osc", code: 10, data: "other" })
  expect(hit).toBe(false)
})
