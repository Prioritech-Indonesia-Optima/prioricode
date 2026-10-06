import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "echo-fixture", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo a message back",
      inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "echo") throw new Error("unknown tool")
  const args = request.params.arguments as { message?: string } | undefined
  return { content: [{ type: "text", text: String(args?.message ?? "") }] }
})

await server.connect(new StdioServerTransport())
