import { expect, test } from "bun:test"
import type { Message, Part } from "@prioricode/sdk/v2"
import { collectQueuedPrompts } from "../../src/component/dialog-queued-prompts"

const user = (id: string): Message => ({ id, role: "user", time: { created: 0 } }) as unknown as Message
const assistant = (id: string, completed?: number): Message =>
  ({ id, role: "assistant", time: { created: 0, ...(completed ? { completed } : {}) } }) as unknown as Message
const text = (value: string, extra: Partial<Part> = {}): Part =>
  ({ type: "text", text: value, ...extra }) as unknown as Part

test("returns nothing while no assistant message is in flight", () => {
  expect(collectQueuedPrompts([user("u1"), assistant("a1", 5)], () => [])).toEqual([])
  expect(collectQueuedPrompts([user("u1")], () => [])).toEqual([])
})

test("collects user messages after the in-flight assistant message", () => {
  const messages = [user("u1"), assistant("a1", 5), user("u2"), assistant("a2"), user("u3"), user("u4")]
  const parts: Record<string, Part[]> = {
    u3: [text("third prompt")],
    u4: [text("fourth "), text("half")],
  }
  const queued = collectQueuedPrompts(messages, (id) => parts[id] ?? [])
  expect(queued.map((item) => item.message.id)).toEqual(["u3", "u4"])
  expect(queued[1]?.text).toBe("fourth \nhalf")
})

test("skips synthetic/ignored-only and blank prompts", () => {
  const messages = [user("u1"), assistant("a1", 5), user("u2"), assistant("a2"), user("u3"), user("u4")]
  const parts: Record<string, Part[]> = {
    u3: [text("hidden", { synthetic: true })],
    u4: [text("   ")],
  }
  expect(collectQueuedPrompts(messages, (id) => parts[id] ?? [])).toEqual([])
})
