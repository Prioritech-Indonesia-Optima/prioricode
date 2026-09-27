import { describe, expect } from "bun:test"
import { fileURLToPath } from "node:url"
import { Effect, Layer } from "effect"
import { Config } from "@prioricode/core/config"
import { ConfigMCP } from "@prioricode/core/config/mcp"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { AbsolutePath } from "@prioricode/core/schema"
import { Location } from "@prioricode/core/location"
import { MCPv2 } from "@prioricode/core/mcp/mcp"
import { SessionV2 } from "@prioricode/core/session"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { ToolOutputStore } from "@prioricode/core/tool-output-store"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, toolDefinitions } from "./lib/tool"

const serverPath = fileURLToPath(new URL("./fixture/mcp-echo-server.ts", import.meta.url))
const directory = AbsolutePath.make(process.cwd())

const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            mcp: new ConfigMCP.Info({
              servers: {
                fixture: new ConfigMCP.Local({ type: "local", command: [process.execPath, serverPath] }),
                broken: new ConfigMCP.Local({ type: "local", command: [process.execPath, "/nonexistent/mcp.ts"], timeout: new ConfigMCP.Timeout({ startup: 1_000, request: 1_000 }) }),
                off: new ConfigMCP.Local({ type: "local", command: ["true"], disabled: true }),
              },
            }),
          }),
        }),
      ]),
  }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, MCPv2.node]), [
    [Config.node, config],
    [Location.node, Layer.succeed(Location.Service, Location.Service.of(location({ directory })))],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

const sessionID = SessionV2.ID.make("ses_mcp_test")

describe("MCPv2", () => {
  it.effect("connects configured stdio servers and exposes their tools as canonical registrations", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const definitions = yield* toolDefinitions(registry)
      const names = definitions.map((definition) => definition.name)
      expect(names).toContain("fixture_echo")
      expect(names).not.toContain("broken_echo")

      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-mcp-echo", name: "fixture_echo", input: { message: "hi from mcp" } },
      })
      expect(result).toEqual({ type: "text", value: "hi from mcp" })
    }),
  )

  it.effect("definition filtering hides denied MCP servers by action while settlement stays captured-leaf policy", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const definitions = yield* toolDefinitions(registry, [{ action: "mcp:fixture", resource: "*", effect: "deny" }])
      expect(definitions.map((definition) => definition.name)).not.toInclude("fixture_echo")
      const settled = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-mcp-hidden", name: "fixture_echo", input: { message: "still runs" } },
      })
      expect(settled).toEqual({ type: "text", value: "still runs" })
    }),
  )
})
