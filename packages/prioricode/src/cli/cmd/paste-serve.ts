import type { Argv } from "yargs"
import http from "node:http"
import { read, type Content } from "@prioricode/tui/clipboard"
import { PASTE_BRIDGE_DEFAULT_PORT, type BridgePayload } from "@prioricode/tui/paste-bridge"
import { UI } from "../ui"

export function clipboardPayload(content: Content | undefined): BridgePayload | undefined {
  if (content === undefined) return undefined
  if (content.mime === "text/plain") return { text: content.data }
  if (content.mime.startsWith("image/")) return { image: { base64: content.data, mime: content.mime } }
  return undefined
}

export const PasteServeCommand = {
  command: "paste-serve",
  describe: "share this machine's clipboard with remote PrioriCode TUI sessions (text and images, any terminal)",
  builder: (yargs: Argv) =>
    yargs.option("port", {
      describe: "loopback port to serve the clipboard on",
      type: "number",
      default: PASTE_BRIDGE_DEFAULT_PORT,
    }),
  handler: async (args: { port: number }) => {
    const server = http.createServer(async (request, response) => {
      if (request.method !== "GET" || (request.url !== "/clipboard" && request.url !== "/")) {
        response.writeHead(404).end()
        return
      }
      const content = await read().catch(() => undefined)
      const payload = clipboardPayload(content)
      if (payload === undefined) {
        response.writeHead(204).end()
        return
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload))
    })
    server.listen(args.port, "127.0.0.1", () => {
      UI.println(`prioricode paste-serve: sharing this machine's clipboard on 127.0.0.1:${args.port}`)
      UI.println("Forward it into remote sessions once — add to ~/.ssh/config under the target Host:")
      UI.println(`    RemoteForward ${args.port} localhost:${args.port}`)
      UI.println("Then Ctrl+V in a remote PrioriCode TUI pastes this machine's clipboard, images included.")
    })
    const shutdown = () =>
      server.close(() => {
        process.exit(0)
      })
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
    await new Promise<void>((resolve) => server.on("close", resolve))
  },
}
