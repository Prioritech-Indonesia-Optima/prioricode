import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { describe, expect, it } from "bun:test"

GlobalRegistrator.register()

const { mount } = await import("./index")
import type { ChatState, Intent } from "./types"

const setup = (options?: Parameters<typeof mount>[1]) => {
  const root = document.createElement("div")
  document.body.appendChild(root)
  const intents: Intent[] = []
  const api = mount(root, { direction: "ltr", ...options })
  api.onIntent((intent) => intents.push(intent))
  return { api, intents, root }
}

const ready: ChatState = { status: "ready", blocks: [], busy: false, lastSeq: 0 }

const click = (node: Element | null | undefined) => {
  if (!node) throw new Error("element not found")
  ;(node as HTMLElement).click()
}

const find = (root: ParentNode, selector: string) => root.querySelector(selector)
const findAll = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector))

describe("ide-chat mount", () => {
  it("shows the welcome screen when ready and empty", () => {
    const { api, root } = setup()
    api.render(ready)
    expect(find(root, ".pc-welcome")).not.toBeNull()
    expect(find(root, ".pc-banner")?.hasAttribute("hidden")).toBe(true)
    expect(find(root, ".pc-status-dot")?.getAttribute("data-status")).toBe("ready")
  })

  it("shows a banner with retry intent when offline", () => {
    const { api, intents, root } = setup()
    api.render({ ...ready, status: "offline", statusDetail: "service down" })
    const banner = find(root, ".pc-banner")
    expect(banner?.hasAttribute("hidden")).toBe(false)
    expect(banner?.textContent).toContain("service down")
    click(find(root, ".pc-banner .pc-btn"))
    expect(intents).toEqual([{ type: "retry" }])
  })

  it("renders user and assistant blocks with safe markdown", () => {
    const { api, root } = setup()
    api.render({
      ...ready,
      blocks: [
        { kind: "user", id: "msg_u", text: "hi there", files: [] },
        {
          kind: "assistant",
          id: "msg_a",
          status: "done",
          agent: "build",
          parts: [{ type: "text", textID: "t", text: "hello **world** <script>alert(1)</script>", streaming: false }],
        },
      ],
    })
    expect(find(root, ".pc-welcome")).toBeNull()
    expect(find(root, ".pc-user-text")?.textContent).toBe("hi there")
    const md = find(root, ".pc-md")
    expect(md?.innerHTML).toContain("<strong>world</strong>")
    expect(md?.innerHTML).not.toContain("<script")
    expect(md?.getAttribute("dir")).toBe("auto")
  })

  it("sends on Enter and clears the composer", () => {
    const { api, intents, root } = setup()
    api.render(ready)
    const textarea = find(root, ".pc-textarea") as HTMLTextAreaElement
    textarea.value = "do the thing  "
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    expect(intents).toHaveLength(1)
    const intent = intents[0]
    expect(intent.type).toBe("send")
    if (intent.type !== "send") return
    expect(intent.text).toBe("do the thing")
    expect(intent.messageID).toStartWith("msg_")
    expect(textarea.value).toBe("")
  })

  it("attaches a pasted image and renders it from the local copy after send", async () => {
    const { api, intents, root } = setup()
    api.render(ready)
    const textarea = find(root, ".pc-textarea") as HTMLTextAreaElement
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "shot.png", { type: "image/png" }),
    )
    textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(find(root, ".pc-chip img")).not.toBeNull()

    textarea.value = "look"
    click(find(root, ".pc-btn-send"))
    const intent = intents[0]
    expect(intent.type).toBe("send")
    if (intent.type !== "send") return
    expect(intent.attachments).toHaveLength(1)
    api.render({
      ...ready,
      blocks: [
        {
          kind: "user",
          id: intent.messageID,
          text: intent.text,
          files: [{ name: "shot.png", mime: "image/png", image: true }],
        },
      ],
    })
    const image = find(root, ".pc-attach-img") as HTMLImageElement
    expect(image).not.toBeNull()
    expect(image.src).toBe("data:image/png;base64,iVBORw0KGgo=")
  })

  it("renders permission cards and dispatches replies", () => {
    const { api, intents, root } = setup()
    api.render({
      ...ready,
      blocks: [{ kind: "permission", id: "per_1", action: "bash", resources: ["rm -rf /tmp/x", "second"] }],
    })
    const buttons = findAll(root, ".pc-card-permission .pc-card-actions .pc-btn")
    expect(buttons.map((b) => b.textContent)).toEqual(["Allow once", "Always allow", "Reject"])
    click(buttons[2])
    expect(intents).toEqual([{ type: "permission-reply", requestID: "per_1", reply: "reject" }])

    api.render({
      ...ready,
      blocks: [{ kind: "permission", id: "per_1", action: "bash", resources: [], resolved: "once" }],
    })
    expect(findAll(root, ".pc-card-permission .pc-card-actions")).toHaveLength(0)
    expect(find(root, ".pc-card-permission")?.textContent).toContain("approved")
  })

  it("keeps question drafts across re-renders and submits answers", () => {
    const { api, intents, root } = setup()
    const block: ChatState["blocks"][number] = {
      kind: "question",
      id: "que_1",
      questions: [
        {
          question: "Env?",
          header: "Env",
          options: [
            { label: "prod", description: "live" },
            { label: "dev", description: "test" },
          ],
          multiple: false,
          custom: true,
        },
      ],
    }
    api.render({ ...ready, blocks: [block] })
    const radios = findAll(root, ".pc-option input") as HTMLInputElement[]
    radios[1].checked = true
    radios[1].dispatchEvent(new Event("change", { bubbles: true }))
    const custom = find(root, ".pc-custom") as HTMLInputElement
    custom.value = "staging"
    custom.dispatchEvent(new Event("input", { bubbles: true }))

    api.render({ ...ready, blocks: [block] })
    expect((findAll(root, ".pc-option input")[1] as HTMLInputElement).checked).toBe(true)
    expect((find(root, ".pc-custom") as HTMLInputElement).value).toBe("staging")

    click(findAll(root, ".pc-card-question .pc-btn")[0])
    expect(intents).toEqual([{ type: "question-reply", requestID: "que_1", answers: [["dev", "staging"]] }])
  })

  it("persists collapsed tool state across re-renders", () => {
    const { api, root } = setup()
    const assistant: ChatState["blocks"][number] = {
      kind: "assistant",
      id: "msg_a",
      status: "running",
      parts: [{ type: "tool", callID: "c1", name: "edit", state: "running", input: '{"path":"a.ts"}' }],
    }
    api.render({ ...ready, blocks: [assistant] })
    const details = find(root, ".pc-part") as HTMLDetailsElement
    expect(details.open).toBe(false)
    details.open = true
    details.dispatchEvent(new Event("toggle"))
    api.render({ ...ready, blocks: [assistant] })
    expect((find(root, ".pc-part") as HTMLDetailsElement).open).toBe(true)
  })

  it("shows stop while busy and dispatches interrupt", () => {
    const { api, intents, root } = setup()
    api.render({ ...ready, busy: true })
    const stop = find(root, ".pc-btn-stop") as HTMLButtonElement
    expect(stop.hidden).toBe(false)
    click(stop)
    expect(intents).toEqual([{ type: "interrupt" }])
    api.render(ready)
    expect((find(root, ".pc-btn-stop") as HTMLButtonElement).hidden).toBe(true)
  })

  it("offers new session once blocks exist", () => {
    const { api, intents, root } = setup()
    api.render(ready)
    expect((find(root, ".pc-header .pc-btn-ghost") as HTMLButtonElement).hidden).toBe(true)
    api.render({ ...ready, blocks: [{ kind: "user", id: "msg_u", text: "x", files: [] }] })
    click(find(root, ".pc-header .pc-btn-ghost"))
    expect(intents).toEqual([{ type: "new-session" }])
  })

  it("mounts RTL and exposes the server label", () => {
    const { api, root } = setup({ direction: "rtl" })
    api.render({ ...ready, serverUrl: "http://10.0.0.5:4096" })
    expect(find(root, ".pc-chat")?.getAttribute("dir")).toBe("rtl")
    const label = find(root, ".pc-server-label") as HTMLElement
    expect(label.hidden).toBe(false)
    expect(label.textContent).toBe("http://10.0.0.5:4096")
  })

  it("stops rendering after destroy", () => {
    const { api, root } = setup()
    api.render(ready)
    api.destroy()
    expect(root.childElementCount).toBe(0)
    api.render({ ...ready, busy: true })
    expect(root.childElementCount).toBe(0)
  })
})
