/**
 * V2 MCP integration: configured servers feed canonical `Tools.Service`
 * registrations inside the Location Scope, so closing a Location closes its
 * client processes and removes exactly those registrations. Connection failures
 * are logged and skipped rather than failing the Location boot.
 *
 * Scope limits remain a follow-up: OAuth-carrying remote servers reuse V1's
 * provider until the V2 credential slice lands, and those servers are skipped
 * with a visible warning here instead of silently misconnecting.
 */
export * as MCPv2 from "./mcp"

import path from "path"
import { Duration, Effect, Layer, Option, Schema } from "effect"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  CallToolResultSchema,
  type CallToolResult,
  type Tool as MCPToolDefinition,
} from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import { makeLocationNode } from "../effect/app-node"
import { InstallationVersion } from "../installation/version"
import { Location } from "../location"
import { ToolRegistry } from "../tool/registry"
import { Tool } from "../tool/tool"
import { Tools } from "../tool/tools"

const DEFAULT_STARTUP_TIMEOUT = 5_000
const DEFAULT_REQUEST_TIMEOUT = 60_000

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")
export const toolName = (serverName: string, name: string) => sanitize(serverName) + "_" + sanitize(name)

const baseEnvironment = () => {
  const allow = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SHELL"]
  return Object.fromEntries(allow.flatMap((key) => (process.env[key] ? [[key, process.env[key] as string]] : [])))
}

const textOf = (result: CallToolResult) =>
  result.content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .filter((text) => text.trim())
    .join("\n\n")

const contentOf = (result: CallToolResult) =>
  result.content.flatMap(
    (item): Array<{ type: "text"; text: string } | { type: "file"; data: string; mime: string; name?: string }> => {
      if (item.type === "text") return [{ type: "text" as const, text: item.text }]
      if (item.type === "image") return [{ type: "file" as const, data: item.data, mime: item.mimeType, name: "image" }]
      if (item.type === "resource" && "text" in item.resource && typeof item.resource.text === "string")
        return [{ type: "text" as const, text: item.resource.text }]
      return []
    },
  )

const convertTool = (serverName: string, definition: MCPToolDefinition, mcp: Client, timeoutMs: number) => {
  const raw = definition.inputSchema as { properties?: Record<string, unknown> }
  const tool = Tool.make({
    description: definition.description ?? `MCP tool ${definition.name} from ${serverName}`,
    input: Schema.Unknown,
    output: Schema.Unknown,
    jsonSchema: {
      ...raw,
      type: "object",
      properties: raw.properties ?? {},
      additionalProperties: false,
    },
    toModelOutput: ({ output }) => {
      const result = output as CallToolResult
      const content = contentOf(result)
      if (content.length > 0) return content
      return [{ type: "text" as const, text: JSON.stringify(result.structuredContent ?? result) }]
    },
    execute: (raw) =>
      Effect.tryPromise({
        try: () =>
          mcp.callTool(
            { name: definition.name, arguments: (raw ?? {}) as Record<string, unknown> },
            CallToolResultSchema,
            { timeout: timeoutMs, resetTimeoutOnProgress: true, onprogress: () => {} },
          ),
        catch: (error) =>
          Tool.failure(
            `MCP tool ${serverName}:${definition.name} failed`,
            error instanceof Error ? error.message : String(error),
          ),
      }).pipe(
        Effect.flatMap((result) => {
          const value = result as CallToolResult
          if (value.isError)
            return Effect.fail(
              Tool.failure(
                `MCP tool ${serverName}:${definition.name} failed`,
                textOf(value) || "MCP tool returned an error",
              ),
            )
          return Effect.succeed(value as unknown)
        }),
      ),
  })
  return Tool.withPermission(tool, `mcp:${sanitize(serverName)}`)
}

type Outcome =
  | {
      readonly _tag: "Connected"
      readonly status: { readonly status: "connected"; readonly tools: number }
      readonly registrations: ReadonlyArray<readonly [string, Tool.AnyTool]>
      readonly client: Client
    }
  | {
      readonly _tag: "Unavailable"
      readonly status: { readonly status: "failed" | "skipped"; readonly detail: string }
    }

const unavailable = (status: { readonly status: "failed" | "skipped"; readonly detail: string }) =>
  ({ _tag: "Unavailable", status }) as const

const buildTransport = (serverName: string, server: ConfigMCP.ServerType, directory: string) =>
  Effect.try({
    try: () =>
      server.type === "local"
        ? (() => {
            const [command, ...args] = server.command
            if (command === undefined) throw new Error(`MCP server ${serverName} has an empty local command`)
            return new StdioClientTransport({
              command,
              args,
              cwd: server.cwd === undefined ? directory : path.resolve(directory, server.cwd),
              env:
                server.environment === undefined ? baseEnvironment() : { ...baseEnvironment(), ...server.environment },
            })
          })()
        : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(
    Effect.map(Option.some),
    Effect.catch(() => Effect.succeed(Option.none())),
  )

const openServer = Effect.fn("MCPv2.openServer")(function* (
  serverName: string,
  server: ConfigMCP.ServerType,
  directory: string,
) {
  if (server.disabled === true) return unavailable({ status: "skipped", detail: "disabled" })
  const startup = server.timeout?.startup ?? DEFAULT_STARTUP_TIMEOUT
  const requestMs = server.timeout?.request ?? DEFAULT_REQUEST_TIMEOUT
  if (server.type === "remote" && server.oauth !== undefined && server.oauth !== false)
    return unavailable({ status: "skipped", detail: "OAuth is not supported by the V2 MCP client yet" })
  const transport = yield* buildTransport(serverName, server, directory)
  if (Option.isNone(transport)) return unavailable({ status: "failed", detail: "invalid local command or remote URL" })
  const connection = yield* Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => {
          const starting = new Client({ name: "prioricode", version: InstallationVersion }, { capabilities: {} })
          return starting.connect(transport.value).then(() => starting)
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      (client) => Effect.tryPromise(() => client.close()).pipe(Effect.ignore),
    )
    const listed = yield* Effect.tryPromise({
      try: () => client.listTools(undefined, { timeout: requestMs }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
    if (client.getServerCapabilities()?.tools === undefined) {
      yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
      return unavailable({ status: "skipped", detail: "server exposes no tools" })
    }
    return {
      _tag: "Connected",
      status: { status: "connected", tools: listed.tools.length },
      registrations: listed.tools.map(
        (definition) =>
          [toolName(serverName, definition.name), convertTool(serverName, definition, client, requestMs)] as const,
      ),
      client,
    } as const
  }).pipe(Effect.timeoutOption(Duration.millis(startup + requestMs)))
  if (Option.isNone(connection)) return unavailable({ status: "failed", detail: "connection or list timed out" })
  return connection.value
})

const registration = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const config = yield* Config.Service
    const location = yield* Location.Service
    const servers = Object.assign(
      {},
      ...(yield* config.entries()).flatMap((entry) =>
        entry.type === "document" && entry.info.mcp?.servers !== undefined ? [entry.info.mcp.servers] : [],
      ),
    ) as Record<string, ConfigMCP.ServerType>
    for (const [serverName, server] of Object.entries(servers)) {
      const outcome: Outcome = yield* openServer(serverName, server, location.directory).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            unavailable({
              status: "failed",
              detail: error instanceof Error ? error.message : String(error),
            }),
          ),
        ),
      )
      if (outcome._tag === "Connected") {
        yield* tools.register(Object.fromEntries(outcome.registrations)).pipe(Effect.catch(() => Effect.void))
        yield* Effect.addFinalizer(() => Effect.tryPromise(() => outcome.client.close()).pipe(Effect.ignore))
        yield* Effect.logInfo("MCP server connected", { server: serverName, tools: outcome.status.tools })
      } else yield* Effect.logWarning("MCP server unavailable", { server: serverName, detail: outcome.status.detail })
    }
  }),
)

export const node = makeLocationNode({
  name: "mcp",
  layer: registration,
  deps: [ToolRegistry.node, Config.node, Location.node],
})
