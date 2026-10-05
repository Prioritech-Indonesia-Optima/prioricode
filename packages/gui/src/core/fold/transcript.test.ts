import { describe, expect, it } from "bun:test"
import { applyEvent, emptyTranscript, foldTranscript, optimisticUser } from "./transcript"
import type { RawEvent } from "../events/normalize"

let counter = 0
const evt = (type: string, data: unknown, seq?: number): RawEvent => {
  counter += 1
  return {
    id: `evt_${counter}`,
    type,
    ...(seq === undefined ? {} : { durable: { aggregateID: "ses_test", seq, version: 1 } }),
    data,
  }
}

const base = { sessionID: "ses_test", timestamp: 0 }
const assistant = (state: ReturnType<typeof emptyTranscript>, id = "msg_a1") =>
  state.blocks.find((block): block is import("./transcript").AssistantBlock => block.id === id && block.kind === "assistant")

describe("fold prompt events", () => {
  it("renders prompt.admitted with file metadata and ignores duplicate prompted", () => {
    let state = applyEvent(
      emptyTranscript(),
      evt("session.next.prompt.admitted", {
        ...base,
        messageID: "msg_u1",
        delivery: "steer",
        prompt: {
          text: "look at this",
          files: [
            { uri: "data:image/png;base64,AAAA", mime: "image/png", name: "clipboard" },
            { uri: "/repo/src/a.ts", mime: "text/plain" },
          ],
        },
      }),
    )
    const block = state.blocks[0]
    expect(block.kind).toBe("user")
    if (block.kind !== "user") return
    expect(block.text).toBe("look at this")
    expect(block.files).toEqual([
      { name: "clipboard", mime: "image/png", image: true },
      { name: undefined, mime: "text/plain", image: false },
    ])

    state = applyEvent(
      state,
      evt("session.next.prompted", {
        ...base,
        messageID: "msg_u1",
        delivery: "steer",
        prompt: { text: "look at this" },
      }),
    )
    expect(state.blocks.length).toBe(1)
  })

  it("adopts an optimistic bubble by messageID without double render", () => {
    let state = optimisticUser(emptyTranscript(), "msg_u9", "hello", [
      { name: "shot.png", mime: "image/png", dataBase64: "AAAA" },
    ])
    expect(state.blocks.length).toBe(1)
    state = applyEvent(
      state,
      evt("session.next.prompt.admitted", {
        ...base,
        messageID: "msg_u9",
        delivery: "steer",
        prompt: { text: "hello", files: [{ uri: "data:image/png;base64,AAAA", mime: "image/png", name: "shot.png" }] },
      }),
    )
    expect(state.blocks.length).toBe(1)
  })
})

describe("fold assistant lifecycle", () => {
  const start = applyEvent(
    emptyTranscript(),
    evt("session.next.step.started", {
      ...base,
      assistantMessageID: "msg_a1",
      agent: "build",
      model: { id: "qwen", providerID: "alibaba" },
    }),
  )

  it("opens assistant block and marks busy", () => {
    expect(start.busy).toBe(true)
    const block = assistant(start)
    expect(block?.kind).toBe("assistant")
    if (block?.kind !== "assistant") return
    expect(block.agent).toBe("build")
    expect(block.model).toBe("alibaba/qwen")
  })

  it("folds text started/delta/ended with authoritative ended value", () => {
    let state = applyEvent(start, evt("session.next.text.started", { ...base, assistantMessageID: "msg_a1", textID: "t1" }))
    state = applyEvent(state, evt("session.next.text.delta", { ...base, assistantMessageID: "msg_a1", textID: "t1", delta: "he" }))
    state = applyEvent(state, evt("session.next.text.delta", { ...base, assistantMessageID: "msg_a1", textID: "t1", delta: "llo " }))
    let block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    expect(block.parts[0]).toEqual({ type: "text", textID: "t1", text: "hello ", streaming: true })

    state = applyEvent(state, evt("session.next.text.ended", { ...base, assistantMessageID: "msg_a1", textID: "t1", text: "hello world" }))
    block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    expect(block.parts[0]).toEqual({ type: "text", textID: "t1", text: "hello world", streaming: false })
  })

  it("buffers a delta that arrives before started", () => {
    let state = applyEvent(start, evt("session.next.text.delta", { ...base, assistantMessageID: "msg_a1", textID: "t9", delta: "early" }))
    state = applyEvent(state, evt("session.next.text.started", { ...base, assistantMessageID: "msg_a1", textID: "t9" }))
    const block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    const part = block.parts.find((candidate) => candidate.type === "text" && candidate.textID === "t9")
    expect(part).toBeDefined()
    if (part?.type !== "text") throw new Error("bad part")
    expect(part.text).toBe("early")
  })

  it("folds reasoning started/delta/ended into a reasoning part", () => {
    let state = applyEvent(start, evt("session.next.reasoning.started", { ...base, assistantMessageID: "msg_a1", reasoningID: "r1" }))
    state = applyEvent(state, evt("session.next.reasoning.delta", { ...base, assistantMessageID: "msg_a1", reasoningID: "r1", delta: "think " }))
    state = applyEvent(state, evt("session.next.reasoning.ended", { ...base, assistantMessageID: "msg_a1", reasoningID: "r1", text: "thinking done" }))
    const block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    expect(block.parts[0]).toEqual({ type: "reasoning", reasoningID: "r1", text: "thinking done", streaming: false })
  })

  it("folds tool lifecycle input.started -> called -> success", () => {
    let state = applyEvent(start, evt("session.next.tool.input.started", { ...base, assistantMessageID: "msg_a1", callID: "c1", name: "bash" }))
    state = applyEvent(state, evt("session.next.tool.input.ended", { ...base, assistantMessageID: "msg_a1", callID: "c1", text: '{"command":"ls"}' }))
    state = applyEvent(state, evt("session.next.tool.called", { ...base, assistantMessageID: "msg_a1", callID: "c1", tool: "bash", input: { command: "ls" }, provider: { executed: false } }))
    state = applyEvent(
      state,
      evt("session.next.tool.success", {
        ...base,
        assistantMessageID: "msg_a1",
        callID: "c1",
        structured: {},
        content: [{ type: "text", text: "file list output" }],
        provider: { executed: false },
      }),
    )
    const block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    const part = block.parts[0]
    expect(part.type).toBe("tool")
    if (part.type !== "tool") return
    expect(part.name).toBe("bash")
    expect(part.state).toBe("success")
    expect(part.summary).toBe("file list output")
  })

  it("folds tool input deltas provisionally then supersedes with ended value", () => {
    let state = applyEvent(start, evt("session.next.tool.input.started", { ...base, assistantMessageID: "msg_a1", callID: "c5", name: "edit" }))
    state = applyEvent(state, evt("session.next.tool.input.delta", { ...base, assistantMessageID: "msg_a1", callID: "c5", delta: '{"path":' }))
    let block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    expect((block.parts[0] as { input?: string }).input).toBe('{"path":')
    state = applyEvent(state, evt("session.next.tool.input.ended", { ...base, assistantMessageID: "msg_a1", callID: "c5", text: '{"path":"/a","diff":"x"}' }))
    block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    expect((block.parts[0] as { input?: string }).input).toBe('{"path":"/a","diff":"x"}')
  })

  it("folds tool.progress into running state", () => {
    let state = applyEvent(start, evt("session.next.tool.called", { ...base, assistantMessageID: "msg_a1", callID: "c6", tool: "task", input: {}, provider: { executed: false } }))
    state = applyEvent(state, evt("session.next.tool.progress", { ...base, assistantMessageID: "msg_a1", callID: "c6", structured: {}, content: [{ type: "text", text: "3 files done" }] }))
    const block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    const part = block.parts[0]
    if (part.type !== "tool") throw new Error("bad part")
    expect(part.state).toBe("running")
    expect(part.progress).toBe("3 files done")
  })

  it("keeps concurrent tool calls and text blocks as separate keyed parts", () => {
    let state = applyEvent(start, evt("session.next.text.started", { ...base, assistantMessageID: "msg_a1", textID: "t1" }))
    state = applyEvent(state, evt("session.next.text.delta", { ...base, assistantMessageID: "msg_a1", textID: "t1", delta: "one" }))
    state = applyEvent(state, evt("session.next.tool.called", { ...base, assistantMessageID: "msg_a1", callID: "c1", tool: "read", input: { path: "a.ts" }, provider: { executed: false } }))
    state = applyEvent(state, evt("session.next.tool.called", { ...base, assistantMessageID: "msg_a1", callID: "c2", tool: "read", input: { path: "b.ts" }, provider: { executed: false } }))
    state = applyEvent(state, evt("session.next.text.started", { ...base, assistantMessageID: "msg_a1", textID: "t2" }))
    state = applyEvent(state, evt("session.next.text.delta", { ...base, assistantMessageID: "msg_a1", textID: "t2", delta: "two" }))
    state = applyEvent(state, evt("session.next.tool.success", { ...base, assistantMessageID: "msg_a1", callID: "c2", structured: {}, content: [{ type: "text", text: "b done" }], provider: { executed: false } }))
    const block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    expect(block.parts.map((part) => part.type)).toEqual(["text", "tool", "tool", "text"])
    const texts = block.parts.filter((part) => part.type === "text")
    expect((texts[0] as { text: string }).text).toBe("one")
    expect((texts[1] as { text: string }).text).toBe("two")
    const tools = block.parts.filter((part) => part.type === "tool")
    expect((tools[0] as { callID: string; state: string }).callID).toBe("c1")
    expect((tools[0] as { state: string }).state).toBe("running")
    expect((tools[1] as { callID: string; state: string; summary?: string }).callID).toBe("c2")
    expect((tools[1] as { state: string }).state).toBe("success")
  })

  it("marks tool failure with error text", () => {
    let state = applyEvent(start, evt("session.next.tool.called", { ...base, assistantMessageID: "msg_a1", callID: "c2", tool: "edit", input: {}, provider: { executed: false } }))
    state = applyEvent(state, evt("session.next.tool.failed", { ...base, assistantMessageID: "msg_a1", callID: "c2", error: { type: "unknown", message: "boom" }, provider: { executed: false } }))
    const block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    const part = block.parts[0]
    expect(part.type).toBe("tool")
    if (part.type !== "tool") return
    expect(part.state).toBe("error")
    expect(part.error).toBe("boom")
  })

  it("folds shell started/ended", () => {
    let state = applyEvent(start, evt("session.next.shell.started", { ...base, messageID: "msg_a1", callID: "s1", command: "ls -la" }))
    state = applyEvent(state, evt("session.next.shell.ended", { ...base, callID: "s1", output: "total 8" }))
    const block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    const part = block.parts[0]
    expect(part.type).toBe("shell")
    if (part.type !== "shell") return
    expect(part.state).toBe("done")
    expect(part.output).toBe("total 8")
  })

  it("settles step.ended with cost/tokens and step.failed", () => {
    let state = applyEvent(
      start,
      evt("session.next.step.ended", {
        ...base,
        assistantMessageID: "msg_a1",
        finish: "stop",
        cost: 0.012,
        tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
        files: ["src/a.ts"],
      }),
    )
    expect(state.busy).toBe(false)
    const block = assistant(state)
    if (block?.kind !== "assistant") throw new Error("missing assistant")
    expect(block.cost).toBe(0.012)
    expect(block.tokens).toEqual({ input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 })
    expect(block.files).toEqual(["src/a.ts"])

    let failed = applyEvent(start, evt("session.next.step.failed", { ...base, assistantMessageID: "msg_a1", error: { type: "unknown", message: "provider exploded" } }))
    expect(failed.busy).toBe(false)
    const failedBlock = assistant(failed)
    expect(failedBlock?.status).toBe("error")
    expect(failedBlock?.kind === "assistant" ? failedBlock.error : undefined).toBe("provider exploded")
  })

  it("attaches retry note to the running assistant", () => {
    const state = applyEvent(start, evt("session.next.retried", { ...base, attempt: 2, error: { message: "rate limited", isRetryable: true } }))
    const block = assistant(state)
    expect(block?.retryNote).toBe("Retrying (attempt 2): rate limited")
  })
})

describe("fold permission and question events", () => {
  it("renders ask card and resolves on replied", () => {
    let state = applyEvent(
      emptyTranscript(),
      evt("permission.v2.asked", {
        id: "per_1",
        sessionID: "ses_test",
        action: "bash",
        resources: ["rm -rf build"],
        source: { type: "tool", messageID: "msg_a1", callID: "c1" },
      }),
    )
    const card = state.blocks[0]
    expect(card.kind).toBe("permission")
    if (card.kind !== "permission") return
    expect(card.action).toBe("bash")
    expect(card.resources).toEqual(["rm -rf build"])

    state = applyEvent(state, evt("permission.v2.replied", { sessionID: "ses_test", requestID: "per_1", reply: "once" }))
    const resolved = state.blocks[0]
    expect(resolved.kind === "permission" ? resolved.resolved : undefined).toBe("once")
  })

  it("ignores replied for unknown or already-resolved requests", () => {
    let state = applyEvent(emptyTranscript(), evt("permission.v2.replied", { sessionID: "ses_test", requestID: "per_missing", reply: "once" }))
    expect(state.blocks.length).toBe(0)

    state = applyEvent(state, evt("permission.v2.asked", { id: "per_2", sessionID: "ses_test", action: "edit", resources: [] }))
    state = applyEvent(state, evt("permission.v2.replied", { sessionID: "ses_test", requestID: "per_2", reply: "reject" }))
    const again = applyEvent(state, evt("permission.v2.replied", { sessionID: "ses_test", requestID: "per_2", reply: "once" }))
    expect(again.blocks[0].kind === "permission" ? (again.blocks[0] as any).resolved : undefined).toBe("reject")
  })

  it("renders question card and resolves", () => {
    let state = applyEvent(
      emptyTranscript(),
      evt("question.v2.asked", {
        id: "que_1",
        sessionID: "ses_test",
        questions: [{ question: "Which env?", header: "Env", options: [{ label: "prod", description: "live" }], multiple: false, custom: true }],
      }),
    )
    const card = state.blocks[0]
    expect(card.kind).toBe("question")
    if (card.kind !== "question") return
    expect(card.questions[0].options[0].label).toBe("prod")

    state = applyEvent(state, evt("question.v2.replied", { sessionID: "ses_test", requestID: "que_1", answers: [["prod"]] }))
    expect(state.blocks[0].kind === "question" ? (state.blocks[0] as any).resolved : undefined).toBe("answered")
  })
})

describe("fold compaction and revert events", () => {
  it("folds a compaction boundary with the settled summary", () => {
    let state = applyEvent(emptyTranscript(), evt("session.next.compaction.started", { ...base, messageID: "msg_c1", reason: "auto" }, 1))
    const running = state.blocks[0]
    expect(running.kind).toBe("compaction")
    if (running.kind !== "compaction") return
    expect(running.state).toBe("running")

    state = applyEvent(state, evt("session.next.compaction.delta", { ...base, messageID: "msg_c1", text: "summ" }))
    state = applyEvent(state, evt("session.next.compaction.ended", { ...base, messageID: "msg_c1", reason: "auto", text: "summary text", recent: "recent turns" }, 2))
    const done = state.blocks[0]
    if (done.kind !== "compaction") throw new Error("bad block")
    expect(done.state).toBe("done")
    expect(done.text).toBe("summary text")
    expect(done.recent).toBe("recent turns")
  })

  it("folds revert staged -> committed and cleared removes the marker", () => {
    let state = applyEvent(emptyTranscript(), evt("session.next.revert.staged", { ...base, revert: { messageID: "msg_u1", files: ["a.ts"] } }, 1))
    const staged = state.blocks[0]
    expect(staged.kind).toBe("revert")
    if (staged.kind !== "revert") return
    expect(staged.messageID).toBe("msg_u1")
    expect(staged.files).toEqual(["a.ts"])

    state = applyEvent(state, evt("session.next.revert.committed", { ...base, messageID: "msg_u1" }, 2))
    if (state.blocks[0].kind !== "revert") throw new Error("bad block")
    expect(state.blocks[0].state).toBe("committed")

    state = applyEvent(state, evt("session.next.revert.cleared", { ...base }, 3))
    expect(state.blocks.length).toBe(0)
  })
})

describe("fold misc events", () => {
  it("renders control notes once", () => {
    let state = applyEvent(emptyTranscript(), evt("session.next.agent.switched", { ...base, messageID: "msg_x", agent: "plan" }))
    state = applyEvent(state, evt("session.next.agent.switched", { ...base, messageID: "msg_x", agent: "plan" }))
    expect(state.blocks.length).toBe(1)
    expect(state.blocks[0].kind === "system" ? state.blocks[0].text : "").toContain("plan")
  })

  it("ignores unknown event types", () => {
    const state = emptyTranscript()
    const next = applyEvent(state, evt("session.next.moved", { ...base, location: {} }))
    expect(next).toBe(state)
  })
})

describe("fold change tracking", () => {
  it("reports changed block ids and busy transitions", () => {
    const started = foldTranscript(emptyTranscript(), evt("session.next.step.started", { ...base, assistantMessageID: "msg_a1", agent: "build", model: { id: "m", providerID: "p" } }))
    expect(started.changed.has("msg_a1")).toBe(true)
    expect(started.changedBusy).toBe(true)

    const unknown = foldTranscript(started.state, evt("session.next.moved", { ...base }))
    expect(unknown.state).toBe(started.state)
    expect(unknown.changed.size).toBe(0)
    expect(unknown.changedBusy).toBe(false)

    const ended = foldTranscript(started.state, evt("session.next.step.ended", { ...base, assistantMessageID: "msg_a1", finish: "stop", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }))
    expect(ended.changed.has("msg_a1")).toBe(true)
    expect(ended.changedBusy).toBe(true)
  })

  it("reports removals in the changed set", () => {
    const staged = foldTranscript(emptyTranscript(), evt("session.next.revert.staged", { ...base, revert: { messageID: "msg_u1" } }))
    const cleared = foldTranscript(staged.state, evt("session.next.revert.cleared", { ...base }))
    expect(cleared.changed.has("revert")).toBe(true)
    expect(cleared.state.blocks.length).toBe(0)
  })
})
