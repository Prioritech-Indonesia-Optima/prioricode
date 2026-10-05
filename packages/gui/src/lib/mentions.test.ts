import { describe, expect, it } from "bun:test"
import { activeMention, formatMention, parseMentions, removeMention } from "./mentions"

describe("parseMentions", () => {
  it("finds plain and ranged mentions with positions", () => {
    const text = "look at @src/a.ts#L10-20 and @README.md please"
    const mentions = parseMentions(text)
    expect(mentions.length).toBe(2)
    expect(mentions[0].path).toBe("src/a.ts")
    expect(mentions[0].range).toEqual({ start: 10, end: 20 })
    expect(text.slice(mentions[0].index, mentions[0].index + mentions[0].token.length)).toBe("@src/a.ts#L10-20")
    expect(mentions[1].path).toBe("README.md")
    expect(mentions[1].range).toBeUndefined()
  })

  it("supports single-line ranges and directory tokens", () => {
    const mentions = parseMentions("hi @packages/gui/src#L7")
    expect(mentions[0].range).toEqual({ start: 7, end: 7 })
    expect(parseMentions("see @docs/")[0].path).toBe("docs/")
  })

  it("ignores emails and mid-word ats", () => {
    expect(parseMentions("mail dev@example.com now")).toEqual([])
  })
})

describe("formatMention / removeMention", () => {
  it("round-trips through parse", () => {
    const token = formatMention("src/b.ts", { start: 4, end: 9 })
    expect(token).toBe("@src/b.ts#L4-9")
    const parsed = parseMentions(`x ${token} y`)
    expect(removeMention(`x ${token} y`, parsed[0]).trim()).toBe("x y")
  })

  it("formats equal start/end as one line", () => {
    expect(formatMention("a.ts", { start: 3, end: 3 })).toBe("@a.ts#L3")
  })
})

describe("activeMention", () => {
  it("detects the fragment under the caret", () => {
    const text = "check @src/comp"
    const active = activeMention(text, text.length)
    expect(active).toEqual({ query: "src/comp", start: 6, end: 15 })
  })

  it("rejects emails and completed tokens", () => {
    expect(activeMention("mail dev@ex", 11)).toBeUndefined()
    expect(activeMention("done @a.ts next", 11)).toBeUndefined()
  })

  it("starts fresh at line beginning", () => {
    const text = "@a"
    expect(activeMention(text, 2)).toEqual({ query: "a", start: 0, end: 2 })
  })
})
