/**
 * Gated end-to-end smoke against a running prioricode daemon.
 * Usage: PRIORICODE_GUI_E2E=1 bun run script/e2e-daemon.ts
 * Reads daemon registration + password from the state dir, boots a real
 * AppTransport (direct mode), and drives the chat store through a full turn.
 */
import { createChatStore } from "../src/app/store"
import type { AppTransport } from "../src/app/transport"
import { basicAuthorization } from "../src/core/transport/direct"
import { createGuiClient } from "../src/core/transport/client"

const stateDir = process.env["XDG_STATE_HOME"] ?? `${process.env["HOME"]}/.local/state`
const registration = JSON.parse(await Bun.file(`${stateDir}/prioricode/server.json`).text()) as { url: string }
const password = (await Bun.file(`${stateDir}/prioricode/password`).text()).trim()
const directory = process.env["PRIORICODE_GUI_E2E_DIR"] ?? process.cwd()

const headers: Record<string, string> = {}
if (password.length > 0) headers.authorization = basicAuthorization("prioricode", password)
const client = createGuiClient({ baseUrl: registration.url, headers })

const health = await client.health.get()
if (health.healthy !== true) throw new Error("unhealthy")
console.log("health ok:", registration.url)

const modelsPage = await client.models.list()
const models = (modelsPage as { data?: unknown }).data ?? modelsPage
const first = Array.isArray(models) ? models[0] : undefined
const defaultModel =
  first !== undefined && typeof first.id === "string" && typeof first.providerID === "string"
    ? { id: first.id, providerID: first.providerID }
    : undefined
console.log("model:", defaultModel === undefined ? "server default" : `${defaultModel.providerID}/${defaultModel.id}`)

const transport: AppTransport = {
  kind: "web",
  baseUrl: registration.url,
  client,
  status: "ready",
  directory,
  defaultModel,
  openStream: async (route, signal) => {
    const response = await fetch(`${registration.url}${route}`, {
      headers: { ...headers, accept: "text/event-stream" },
      signal,
    })
    if (!response.ok || response.body === null) throw new Error(`stream http ${response.status}`)
    return response
  },
  retry: () => {},
}

const store = createChatStore(transport)
const marker = "GUI-E2E-" + Math.random().toString(36).slice(2, 8)
await store.send(`Reply with exactly this single line and nothing else: ${marker}`)
console.log("session:", store.getSnapshot().sessionID)

const deadline = Date.now() + 120_000
let done = false
while (Date.now() < deadline) {
  const snapshot = store.getSnapshot()
  if (snapshot.note !== undefined) throw new Error("store note: " + snapshot.note)
  const assistant = snapshot.transcript.blocks.find((block) => block.kind === "assistant")
  if (assistant && assistant.kind === "assistant") {
    if (assistant.status === "done" && !snapshot.transcript.busy) {
      const text = assistant.parts
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
      if (!text.includes(marker)) throw new Error(`marker missing; reply was: ${text.slice(0, 200)}`)
      console.log("assistant text ok:", text.slice(0, 80).replace(/\n/g, " "))
      console.log("session:", snapshot.sessionID, "lastSeq:", store.getSnapshot().transcript.lastSeq)
      done = true
      break
    }
    if (assistant.status === "error") {
      store.dispose()
      const allowNoProvider = process.env["PRIORICODE_GUI_E2E_ALLOW_NO_PROVIDER"] === "1"
      if (allowNoProvider && /401|api key/i.test(assistant.error ?? "")) {
        console.log(
          `E2E PARTIAL PASS: session/prompt/stream/fold lifecycle works; provider rejected auth (${assistant.error?.slice(0, 90)}). ` +
            "Set a provider key and rerun without PRIORICODE_GUI_E2E_ALLOW_NO_PROVIDER for the full assertion.",
        )
        process.exit(0)
      }
      throw new Error(`assistant step failed: ${assistant.error ?? "?"} (session ${snapshot.sessionID})`)
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}
store.dispose()
if (!done) throw new Error("timeout waiting for assistant turn")
console.log("E2E PASS")
