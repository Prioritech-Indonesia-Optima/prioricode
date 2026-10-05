import { describe, expect, it } from "bun:test"
import { createChatStore } from "./store"
import type { AppTransport } from "./transport"
import type { GuiClient } from "../core/transport/client"

const waitFor = async (predicate: () => boolean, message: string) => {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error("timeout waiting: " + message)
}

interface HarnessOptions {
  directory?: string
  client?: string
  events?: Record<string, unknown>[]
}

function harness(options: HarnessOptions = {}) {
  const postedStreams: string[] = []
  const promptCalls: Record<string, unknown>[] = []
  const interruptCalls: string[] = []
  const createCalls: Record<string, unknown>[] = []

  const streamFrames = (options.events ?? []).map((event) => `data: ${JSON.stringify(event)}\n\n`)
  const openStream = async (route: string, signal: AbortSignal): Promise<Response> => {
    postedStreams.push(route)
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const frame of streamFrames) controller.enqueue(new TextEncoder().encode(frame))
          signal.addEventListener("abort", () => {
            try {
              controller.error(new Error("aborted"))
            } catch {}
          })
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  }

  const client = {
    sessions: {
      create: async (input: Record<string, unknown>) => {
        createCalls.push(input)
        return { id: "ses_fake" }
      },
      prompt: async (input: Record<string, unknown>) => {
        promptCalls.push(input)
      },
      interrupt: async (input: { sessionID: string }) => {
        interruptCalls.push(input.sessionID)
      },
    },
    permissions: { list: async () => [], reply: async () => {} },
    questions: { list: async () => [], reply: async () => {}, reject: async () => {} },
  } as unknown as GuiClient

  const transport: AppTransport = {
    kind: "web",
    baseUrl: "http://fake",
    client: options.client === "none" ? undefined : client,
    status: "ready",
    directory: "directory" in options ? options.directory : "/tmp/project",
    openStream,
    retry: () => {},
  }
  const store = createChatStore(transport)
  return { store, postedStreams, promptCalls, interruptCalls, createCalls }
}

const evt = (type: string, data: Record<string, unknown>, seq?: number) => ({
  id: `e_${type}_${seq ?? 0}`,
  type,
  ...(seq === undefined ? {} : { durable: { aggregateID: "ses_fake", seq, version: 1 } }),
  data: { sessionID: "ses_fake", timestamp: 0, ...data },
})

describe("chat store", () => {
  it("creates a session on first send, adopts optimistic user, and folds streamed events", async () => {
    const h = harness({
      events: [
        evt("session.next.step.started", { assistantMessageID: "msg_a1", agent: "build", model: { id: "m", providerID: "p" } }, 1),
        evt("session.next.text.ended", { assistantMessageID: "msg_a1", textID: "t1", text: "hello from prioricode" }, 2),
        evt("session.next.step.ended", { assistantMessageID: "msg_a1", finish: "stop", cost: 0, tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } }, 3),
      ],
    })
    await h.store.send("hi there")
    expect(h.createCalls).toEqual([{ location: { directory: "/tmp/project" } }])
    expect(h.promptCalls[0]).toMatchObject({ sessionID: "ses_fake", prompt: { text: "hi there" } })
    expect(typeof h.promptCalls[0]?.id).toBe("string")
    expect(h.postedStreams[0]).toBe("/api/session/ses_fake/event?after=0")

    await waitFor(() => {
      const blocks = h.store.getSnapshot().transcript.blocks
      return blocks.length >= 2 && blocks.some((block) => block.kind === "assistant")
    }, "assistant block")
    const state = h.store.getSnapshot()
    const user = state.transcript.blocks.find((block) => block.kind === "user")
    const assistant = state.transcript.blocks.find((block) => block.kind === "assistant")
    expect(user?.kind === "user" ? user.text : "").toBe("hi there")
    expect(assistant?.kind === "assistant" ? assistant.parts.some((part) => part.type === "text" && part.text === "hello from prioricode") : false).toBe(true)
    expect(state.transcript.busy).toBe(false)
    expect(state.transcript.lastSeq).toBe(0)
    h.store.dispose()
  })

  it("keeps busy during a running step", async () => {
    const h = harness({ events: [evt("session.next.step.started", { assistantMessageID: "msg_a1", agent: "build", model: { id: "m", providerID: "p" } }, 1)] })
    await h.store.send("work")
    await waitFor(() => h.store.getSnapshot().transcript.busy, "busy true")
    h.store.dispose()
  })

  it("interrupts the active session", async () => {
    const h = harness()
    await h.store.send("first")
    await h.store.interrupt()
    expect(h.interruptCalls).toEqual(["ses_fake"])
    h.store.dispose()
  })

  it("passes delivery mode through to the prompt payload", async () => {
    const h = harness()
    await h.store.send("queued", [], { delivery: "queue" })
    expect(h.promptCalls[0]).toMatchObject({ delivery: "queue" })
    h.store.dispose()
  })

  it("reports a note instead of sending when no directory is known", async () => {
    const h = harness({ directory: undefined })
    await h.store.send("hi")
    expect(h.promptCalls.length).toBe(0)
    expect(h.store.getSnapshot().note).toContain("folder")
    h.store.dispose()
  })

  it("reports a note when the server is not connected", async () => {
    const h = harness({ client: "none" })
    await h.store.send("hi")
    expect(h.createCalls.length).toBe(0)
    expect(h.store.getSnapshot().note).toContain("Retry")
    h.store.dispose()
  })

  it("newSession clears transcript and restarts on next send", async () => {
    const h = harness({ events: [evt("session.next.text.ended", { assistantMessageID: "msg_a1", textID: "t1", text: "x" }, 1)] })
    await h.store.send("hi")
    await waitFor(() => h.store.getSnapshot().transcript.blocks.length > 0, "blocks")
    h.store.newSession()
    expect(h.store.getSnapshot().transcript.blocks.length).toBe(0)
    await h.store.send("again")
    expect(h.createCalls.length).toBe(2)
    h.store.dispose()
  })
})
