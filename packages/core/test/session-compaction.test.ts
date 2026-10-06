import { expect, test } from "bun:test"
import { ModelV2 } from "@prioricode/core/model"
import { ProviderV2 } from "@prioricode/core/provider"
import { SessionCompaction } from "@prioricode/core/session/compaction"
import { SessionMessage } from "@prioricode/core/session/message"
import { DateTime } from "effect"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toStartWith(
    "Here is the conversation so far:\n\n<conversation>\nconversation history\n</conversation>",
  )
  expect(prompt.indexOf("</conversation>")).toBeLessThan(prompt.indexOf("Create a new anchored summary"))
  expect(prompt).toContain("conversation history in the <conversation> tags above")
  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("compaction prompt gives update instructions for a prior summary", () => {
  const prompt = SessionCompaction.buildPrompt({
    context: ["new conversation"],
    previousSummary: "existing summary",
  })

  expect(prompt.indexOf("<conversation>")).toBeLessThan(prompt.indexOf("<prior-summary>"))
  expect(prompt.indexOf("</prior-summary>")).toBeLessThan(prompt.indexOf("The <prior-summary> summarizes"))
  expect(prompt).toContain(
    "Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from the <prior-summary>",
  )
  expect(prompt).toContain('Move completed work from "Active" to "Completed".')
  expect(prompt).toContain('Update "Objective" and "Next Move" to reflect the current work state.')
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

test("compaction transcript pairs every tool call with a result line", () => {
  const created = DateTime.makeUnsafe(0)
  const assistant = (content: SessionMessage.Assistant["content"]) =>
    SessionMessage.Assistant.make({
      id: SessionMessage.ID.make("msg_compaction-tools"),
      type: "assistant",
      agent: "build",
      model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
      content,
      time: { created, completed: created },
    })
  const tool = (id: string, state: SessionMessage.AssistantTool["state"]) =>
    SessionMessage.AssistantTool.make({ type: "tool", id, name: "read", state, time: { created } })

  const text = SessionCompaction.serialize(
    assistant([
      tool("pending", SessionMessage.ToolStatePending.make({ status: "pending", input: '{"path":"a.ts"}' })),
      tool(
        "running",
        SessionMessage.ToolStateRunning.make({
          status: "running",
          input: { path: "b.ts" },
          content: [],
          structured: {},
        }),
      ),
    ]),
  )

  expect(text).toContain('[Assistant tool call]: read({"path":"a.ts"})')
  expect(text).toContain("[Tool result]: [Tool execution interrupted]")
  expect(text.match(/\[Assistant tool call\]/g)).toHaveLength(2)
  expect(text.match(/\[Tool (result|error)\]/g)).toHaveLength(2)
})
