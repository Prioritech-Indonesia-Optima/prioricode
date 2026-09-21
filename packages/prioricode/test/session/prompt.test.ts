import { ConfigV1 } from "@prioricode/core/v1/config/config"
import { SessionV1 } from "@prioricode/core/v1/session"
import { Database } from "@prioricode/core/database/database"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { SessionProjector } from "@prioricode/core/session/projector"
import { eq } from "drizzle-orm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { describe, expect } from "bun:test"
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer } from "effect"
import path from "path"
import { fileURLToPath } from "url"
import { NamedError } from "@prioricode/core/util/error"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"

import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { Coordination } from "@/session/coordination"
import { CoordinationWatcher } from "@/session/coordination-watcher"
import { SessionMessageTable, SessionTable } from "@prioricode/core/session/sql"
import { CoordinationTable } from "@prioricode/core/session/coordination.sql"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@prioricode/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionV2 } from "@prioricode/core/session"
import { SessionExecution } from "@prioricode/core/session/execution"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Shell } from "@prioricode/core/shell"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { SessionsTool } from "@/tool/sessions"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@prioricode/core/cross-spawn-spawner"
import { Ripgrep } from "@prioricode/core/ripgrep"
import { Format } from "../../src/format"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@prioricode/core/provider"
import { ModelV2 } from "@prioricode/core/model"
import { LocationServiceMap, locationServiceMapLayer } from "@prioricode/core/location-services"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

function withSh<A, E, R>(fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.SHELL
      process.env.SHELL = "/bin/sh"
      Shell.preferred.reset()
      return prev
    }),
    () => fx(),
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env.SHELL
        else process.env.SHELL = prev
        Shell.preferred.reset()
      }),
  )
}

function toolPart(parts: SessionV1.Part[]) {
  return parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
}

type CompletedToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateCompleted }
type ErrorToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateError }

function completedTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("completed")
  return part?.state.status === "completed" ? (part as CompletedToolPart) : undefined
}

function errorTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("error")
  return part?.state.status === "error" ? (part as ErrorToolPart) : undefined
}

function makeMcp(instructions: MCP.ServerInstructions[] = []) {
  return Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      status: () => Effect.succeed({}),
      clients: () => Effect.succeed({}),
      instructions: () => Effect.succeed(instructions),
      tools: () => Effect.succeed({}),
      prompts: () => Effect.succeed({}),
      resources: () => Effect.succeed({}),
      resourceTemplates: () => Effect.succeed({}),
      add: () => Effect.succeed({ status: { status: "disabled" as const } }),
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      getPrompt: () => Effect.succeed(undefined),
      readResource: () => Effect.succeed(undefined),
      startAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      authenticate: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      finishAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      removeAuth: () => Effect.void,
      supportsOAuth: () => Effect.succeed(false),
      hasStoredTokens: () => Effect.succeed(false),
      getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    }),
  )
}

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const processorCreateStarted: Array<() => void> = []
const blockingProcessor = Layer.succeed(
  SessionProcessor.Service,
  SessionProcessor.Service.of({
    create: () => Effect.sync(() => processorCreateStarted.shift()?.()).pipe(Effect.andThen(Effect.never)),
  }),
)

const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })

const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const promptRoot = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
])

function makePrompt(input?: { mcpInstructions?: MCP.ServerInstructions[]; processor?: "blocking" }) {
  const replacements = [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp(input?.mcpInstructions)],
    [RuntimeFlags.node, runtimeFlags],
  ] as const
  if (input?.processor === "blocking") {
    return LayerNode.compile(promptRoot, [...replacements, [SessionProcessor.node, blockingProcessor]])
  }
  return LayerNode.compile(promptRoot, replacements)
}

function makeHttp(input?: { mcpInstructions?: MCP.ServerInstructions[]; processor?: "blocking" }) {
  const root = LayerNode.group([promptRoot, testLLMServerNode])
  const replacements = [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp(input?.mcpInstructions)],
    [RuntimeFlags.node, runtimeFlags],
  ] as const
  if (input?.processor === "blocking") {
    return LayerNode.compile(root, [...replacements, [SessionProcessor.node, blockingProcessor]])
  }
  return LayerNode.compile(root, replacements)
}

function makeHttpNoLLMServer(input?: { mcpInstructions?: MCP.ServerInstructions[]; processor?: "blocking" }) {
  return makePrompt(input)
}

const it = testEffect(makeHttp())
const noLLMServer = testEffect(makeHttpNoLLMServer())
const raceNoLLMServer = testEffect(makeHttpNoLLMServer({ processor: "blocking" }))
const withMcpInstructions = testEffect(
  makeHttp({
    mcpInstructions: [
      {
        name: "guide-server",
        instructions: "Use lookup before mutate.",
        tools: ["guide-server_lookup"],
      },
    ],
  }),
)
const unix = process.platform !== "win32" ? it.instance : it.instance.skip
const unixNoLLMServer = process.platform !== "win32" ? noLLMServer.instance : noLLMServer.instance.skip

function makeHttpCoordination(flags?: Partial<RuntimeFlags.Info>) {
  const root = LayerNode.group([promptRoot, testLLMServerNode, Coordination.node, CoordinationWatcher.node])
  const replacements = [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp()],
    [RuntimeFlags.node, RuntimeFlags.layer({ ...runtimeFlagsValue, ...flags })],
  ] as const
  return LayerNode.compile(root, replacements)
}

const runtimeFlagsValue = { experimentalEventSystem: true }
const coordinationIt = testEffect(makeHttpCoordination())
const coordinationNoResponderIt = testEffect(makeHttpCoordination({ disableCoordinationResponder: true }))

// Config that registers a custom "test" provider with a "test-model" model
// so provider model lookup succeeds inside the loop.
const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, text)
})

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  yield* writeText(
    path.join(dir, "prioricode.json"),
    JSON.stringify({ $schema: "https://prioricode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* (config: (url: string) => Partial<ConfigV1.Info>) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

// Wait for a session's runner to enter a busy state. SessionStatus is flipped
// inside Runner.startShell's serialized transition, so cancel can't no-op once
// we observe it.
const waitForBusy = (sessionID: SessionID, duration: Duration.Input = "2 seconds") =>
  pollWithTimeout(
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      const s = yield* status.get(sessionID)
      return s.type === "busy" ? (true as const) : undefined
    }),
    `session ${sessionID} never became busy`,
    duration,
  )

const hasBash = Effect.sync(() => Bun.which("bash") !== null)

const deferredAsPromise = <A>(deferred: Deferred.Deferred<A>): PromiseLike<A> => ({
  then: (onfulfilled, onrejected) => {
    Effect.runFork(
      Deferred.await(deferred).pipe(
        Effect.match({
          onFailure: (error) => {
            onrejected?.(error)
          },
          onSuccess: (value) => {
            onfulfilled?.(value)
          },
        }),
      ),
    )
    return deferredAsPromise(deferred) as PromiseLike<never>
  },
})

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const succeedVoid = (deferred: Deferred.Deferred<void>) => {
  Effect.runSync(Deferred.succeed(deferred, void 0).pipe(Effect.ignore))
}

const user = Effect.fn("test.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const seed = Effect.fn("test.seed")(function* (sessionID: SessionID, opts?: { finish?: string }) {
  const session = yield* Session.Service
  const msg = yield* user(sessionID, "hello")
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: msg.id,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
    ...(opts?.finish ? { finish: opts.finish } : {}),
  }
  yield* session.updateMessage(assistant)
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "text",
    text: "hi there",
  })
  return { user: msg, assistant }
})

const addSubtask = (sessionID: SessionID, messageID: MessageID, model = ref) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    yield* session.updatePart({
      id: PartID.ascending(),
      messageID,
      sessionID,
      type: "subtask",
      prompt: "look into the cache key path",
      description: "inspect bug",
      agent: "general",
      model,
    })
  })

const boot = Effect.fn("test.boot")(function* (input?: { title?: string }) {
  const config = yield* Config.Service
  const prompt = yield* SessionPrompt.Service
  const run = yield* SessionRunState.Service
  const sessions = yield* Session.Service
  yield* config.get()
  const chat = yield* sessions.create(input ?? { title: "Pinned" })
  return { prompt, run, sessions, chat }
})

// Loop semantics

noLLMServer.instance(
  "loop exits immediately when last assistant has stop finish",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* seed(chat.id, { finish: "stop" })

      const result = yield* prompt.loop({ sessionID: chat.id })
      expect(result.info.role).toBe("assistant")
      if (result.info.role === "assistant") expect(result.info.finish).toBe("stop")
    }),
  { config: cfg },
)

noLLMServer.instance(
  "loop exits for a completed parent turn with nonmonotonic message IDs",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      const userID = MessageID.make("msg_z_user")
      const assistantID = MessageID.make("msg_a_assistant")
      yield* sessions.updateMessage({
        id: userID,
        role: "user",
        sessionID: chat.id,
        agent: "build",
        model: ref,
        time: { created: 100 },
      })
      yield* sessions.updateMessage({
        id: assistantID,
        role: "assistant",
        parentID: userID,
        sessionID: chat.id,
        mode: "build",
        agent: "build",
        cost: 0,
        path: { cwd: "/tmp", root: "/tmp" },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        time: { created: 200, completed: 201 },
        finish: "stop",
      })

      const result = yield* prompt.loop({ sessionID: chat.id })

      expect(result.info.id).toBe(assistantID)
    }),
  { config: cfg },
)

it.instance("loop exits without an LLM request for interrupted orphan tool calls", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const seeded = yield* seed(chat.id, { finish: "stop" })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: seeded.assistant.id,
      sessionID: chat.id,
      type: "tool",
      callID: "interrupted-call",
      tool: "edit",
      state: {
        status: "error",
        input: {},
        error: "Tool execution aborted",
        metadata: { interrupted: true },
        time: { start: 1, end: 2 },
      },
    })

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.id).toBe(seeded.assistant.id)
    expect(yield* llm.hits).toHaveLength(0)
  }),
)

it.instance("loop calls LLM and returns assistant message", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.text("world")

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    const parts = result.parts.filter((p) => p.type === "text")
    expect(parts.some((p) => p.type === "text" && p.text === "world")).toBe(true)
    expect(yield* llm.hits).toHaveLength(1)
  }),
)

withMcpInstructions.instance(
  "loop includes MCP instructions in model system context",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(llm.wait(1), "timed out waiting for MCP instruction request", "10 seconds")

      const hits = yield* llm.hits
      const body = JSON.stringify(hits[0]?.body)
      expect(body).toContain('<server name=\\"guide-server\\">')
      expect(body).toContain("Use lookup before mutate.")
      yield* Fiber.interrupt(fiber)
    }),
  15_000,
)

it.instance("legacy prompt emits message events without session.next events", () =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Pinned",
      agent: "plan",
      model: { providerID: ProviderV2.ID.make("old"), id: ModelV2.ID.make("old-model") },
    })
    const seen: string[] = []
    const off = yield* events.listen((event) => {
      seen.push(event.type)
      return Effect.void
    })

    const first = yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    const second = yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "again" }],
    })
    yield* off

    expect(first.info.role).toBe("user")
    expect(second.info.role).toBe("user")
    if (first.info.role === "user" && second.info.role === "user") {
      expect(first.info.model).toEqual(ref)
      expect(second.info.model).toEqual(ref)
    }
    expect(yield* sessions.get(chat.id)).toMatchObject({
      agent: "build",
      model: { providerID: ref.providerID, id: ref.modelID },
    })
    expect(seen).toContain(Session.Event.Updated.type)
    expect(seen).toContain(MessageV2.Event.Updated.type)
    expect(seen).toContain(MessageV2.Event.PartUpdated.type)
    expect(seen.filter((type) => type.startsWith("session.next."))).toEqual([])
  }),
)

it.instance("loop surfaces content-filter finishes as session errors", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const errors: NonNullable<SessionV1.Assistant["error"]>[] = []
    const expected = {
      name: "ContentFilterError",
      data: { message: "The response was blocked by the provider's content filter" },
    } satisfies NonNullable<SessionV1.Assistant["error"]>
    const off = yield* events.listen((event) => {
      if (event.type !== Session.Event.Error.type) return Effect.void
      const data = event.data as typeof Session.Event.Error.data.Type
      if (data.sessionID === chat.id && data.error) errors.push(data.error)
      return Effect.void
    })

    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply().text("partial response").contentFilter())

    const result = yield* prompt.loop({ sessionID: chat.id })
    const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: result.info.id })
    yield* off

    expect(yield* llm.hits).toHaveLength(1)
    expect(result.info.role).toBe("assistant")
    expect(stored.info.role).toBe("assistant")
    if (result.info.role === "assistant" && stored.info.role === "assistant") {
      expect(result.info.finish).toBe("content-filter")
      expect(result.info.error).toEqual(expected)
      expect(stored.info.error).toEqual(result.info.error)
      expect(errors).toContainEqual(expected)
    }
    expect(result.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "partial response" })]),
    )
  }),
)

it.instance("loop stops provider overflow instead of auto-compacting when disabled", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      compaction: { auto: false },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.error(413, { error: { message: "request entity too large" } })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })

    const result = yield* prompt.loop({ sessionID: chat.id })
    const messages = yield* sessions.messages({ sessionID: chat.id })

    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.info.error?.name).toBe("ContextOverflowError")
      expect(result.info.finish).toBe("error")
    }
    expect(messages.some((message) => message.parts.some((part) => part.type === "compaction"))).toBe(false)
  }),
)

it.instance("loop triggers pre-emptive auto-compaction when estimated tokens exceed threshold", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      compaction: { threshold: 1 },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Threshold" })

    // 5000 chars of text → JSON ~5500 chars → Token.estimate ≈ 1375 > trigger (1000)
    const bigText = "x".repeat(5_000)

    // Response 1: compaction summary (called by compaction.process)
    yield* llm.text("summary", { usage: { input: 100, output: 100 } })
    // Response 2: reply to the synthetic "Continue" message after compaction
    yield* llm.text("done", { usage: { input: 100, output: 100 } })

    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: bigText }],
    })

    yield* prompt.loop({ sessionID: chat.id })
    const messages = yield* sessions.messages({ sessionID: chat.id })

    const hasCompaction = messages.some((m) => m.parts.some((p) => p.type === "compaction"))
    expect(hasCompaction).toBe(true)
  }),
)

it.instance("loop does not trigger pre-emptive auto-compaction when estimated tokens are below threshold", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      compaction: { threshold: 80 },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "BelowThreshold" })

    // Short message → Token.estimate well below trigger (80000)
    yield* llm.text("response", { usage: { input: 100, output: 100 } })

    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })

    yield* prompt.loop({ sessionID: chat.id })
    const messages = yield* sessions.messages({ sessionID: chat.id })

    const hasCompaction = messages.some((m) => m.parts.some((p) => p.type === "compaction"))
    expect(hasCompaction).toBe(false)
  }),
)

noLLMServer.instance.skip(
  "prompt emits v2 prompted and synthetic events (v2 projector disabled)",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [
          { type: "text", text: "hello v2" },
          {
            type: "file",
            mime: "text/plain",
            filename: "note.txt",
            url: "data:text/plain;base64,bm90ZSBjb250ZW50",
          },
        ],
      })

      const messages = yield* SessionV2.Service.use((session) => session.messages({ sessionID: chat.id })).pipe(
        Effect.provide(
          LayerNode.compile(SessionV2.node, [
            [SessionExecution.node, SessionExecution.noopLayer],
            [LocationServiceMap.node, locationServiceMapLayer],
          ]),
        ),
      )
      const { db } = yield* Database.Service
      const row = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, chat.id))
        .get()
        .pipe(Effect.orDie)
      expect(messages.find((message) => message.type === "user")).toMatchObject({ type: "user", text: "hello v2" })
      expect(typeof row?.data.time.created).toBe("number")
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "synthetic", text: expect.stringContaining("Called the Read tool") }),
          expect.objectContaining({ type: "synthetic", text: "note content" }),
        ]),
      )
    }),
  { config: cfg },
)

it.instance("static loop returns assistant text through local provider", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Prompt provider",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })

    yield* llm.text("world")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(result.info.role).toBe("assistant")
    expect(result.parts.some((part) => part.type === "text" && part.text === "world")).toBe(true)
    expect(yield* llm.hits).toHaveLength(1)
    expect(yield* llm.pending).toBe(0)
  }),
)

it.instance("static loop consumes queued replies across turns", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Prompt provider turns",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello one" }],
    })

    yield* llm.text("world one")

    const first = yield* prompt.loop({ sessionID: session.id })
    expect(first.info.role).toBe("assistant")
    expect(first.parts.some((part) => part.type === "text" && part.text === "world one")).toBe(true)

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello two" }],
    })

    yield* llm.text("world two")

    const second = yield* prompt.loop({ sessionID: session.id })
    expect(second.info.role).toBe("assistant")
    expect(second.parts.some((part) => part.type === "text" && part.text === "world two")).toBe(true)

    expect(yield* llm.hits).toHaveLength(2)
    expect(yield* llm.pending).toBe(0)
  }),
)

it.instance("loop continues when finish is tool-calls", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.tool("first", { value: "first" })
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("loop continues when finish is unknown", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply())
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("glob tool keeps instance context during prompt runs", () =>
  Effect.gen(function* () {
    const { dir, llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Glob context",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    const file = path.join(dir, "probe.txt")
    yield* writeText(file, "probe")

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "find text files" }],
    })
    yield* llm.tool("glob", { pattern: "**/*.txt" })
    yield* llm.text("done")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(result.info.role).toBe("assistant")

    const msgs = yield* MessageV2.filterCompactedEffect(session.id)
    const tool = msgs
      .flatMap((msg) => msg.parts)
      .find(
        (part): part is CompletedToolPart =>
          part.type === "tool" && part.tool === "glob" && part.state.status === "completed",
      )
    if (!tool) return

    expect(tool.state.output).toContain(file)
    expect(tool.state.output).not.toContain("No context found for instance")
    expect(result.parts.some((part) => part.type === "text" && part.text === "done")).toBe(true)
  }),
)

it.instance("loop continues when finish is stop but assistant has tool parts", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply().tool("first", { value: "first" }).stop())
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("failed subtask preserves metadata on error tool state", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      agent: {
        general: {
          model: "test/missing-model",
        },
      },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.tool("task", {
      description: "inspect bug",
      prompt: "look into the cache key path",
      subagent_type: "general",
    })
    yield* llm.text("done")
    const msg = yield* user(chat.id, "hello")
    yield* addSubtask(chat.id, msg.id)

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    expect(yield* llm.calls).toBe(2)

    const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
    const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
    expect(taskMsg?.info.role).toBe("assistant")
    if (!taskMsg || taskMsg.info.role !== "assistant") return

    const tool = errorTool(taskMsg.parts)
    if (!tool) return

    expect(tool.state.error).toContain("Tool execution failed")
    expect(tool.state.metadata).toBeDefined()
    expect(tool.state.metadata?.sessionId).toBeDefined()
    expect(tool.state.metadata?.model).toEqual({
      providerID: ProviderV2.ID.make("test"),
      modelID: ModelV2.ID.make("missing-model"),
    })
  }),
)

it.instance("subtask child inherits parent session external_directory allow", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Parent",
      permission: [{ permission: "external_directory", pattern: "/tmp/allowed/*", action: "allow" }],
    })
    yield* llm.text("done")
    const msg = yield* user(chat.id, "hello")
    yield* addSubtask(chat.id, msg.id)

    yield* prompt.loop({ sessionID: chat.id })

    const kids = yield* sessions.children(chat.id)
    expect(kids).toHaveLength(1)
    const child = kids[0]!
    const rules = child.permission ?? []
    expect(rules).toEqual(
      expect.arrayContaining([{ permission: "external_directory", pattern: "/tmp/allowed/*", action: "allow" }]),
    )
    expect(Permission.evaluate("external_directory", "/tmp/allowed/file", rules).action).toBe("allow")
    expect(Permission.evaluate("task", "anything", rules).action).toBe("deny")
  }),
)

noLLMServer.instance("prompt tools replace previous prompt tool rules", () =>
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt tools" })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      tools: { bash: false },
      parts: [{ type: "text", text: "first" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      tools: { read: true },
      parts: [{ type: "text", text: "second" }],
    })

    const reloaded = yield* sessions.get(session.id)
    expect(reloaded.permission).toEqual([{ permission: "read", pattern: "*", action: "allow" }])
    expect(Permission.evaluate("bash", "anything", reloaded.permission ?? []).action).toBe("ask")
  }),
)

it.instance(
  "running subtask preserves metadata after tool-call transition",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

      const tool = yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
          const tool = taskMsg?.parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
          if (tool?.state.status === "running" && tool.state.metadata?.sessionId) return tool
        }),
        "timed out waiting for running subtask metadata",
      )

      if (tool.state.status !== "running") return
      expect(typeof tool.state.metadata?.sessionId).toBe("string")
      expect(tool.state.title).toBeDefined()
      expect(tool.state.metadata?.model).toBeDefined()

      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
    }),
  5_000,
)

it.instance(
  "running task tool preserves metadata after tool-call transition",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.tool("task", {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
      })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

      const tool = yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const assistant = msgs.findLast((item) => item.info.role === "assistant" && item.info.agent === "build")
          const tool = assistant?.parts.find(
            (part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === "task",
          )
          if (tool?.state.status === "running" && tool.state.metadata?.sessionId) return tool
        }),
        "timed out waiting for running task metadata",
      )

      if (tool.state.status !== "running") return
      expect(typeof tool.state.metadata?.sessionId).toBe("string")
      expect(tool.state.title).toBe("inspect bug")
      expect(tool.state.metadata?.model).toBeDefined()

      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
    }),
  10_000,
)

it.instance(
  "loop sets status to busy then idle",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const status = yield* SessionStatus.Service

      yield* llm.hang

      const chat = yield* sessions.create({})
      yield* user(chat.id, "hi")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      expect((yield* status.get(chat.id)).type).toBe("busy")
      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
      expect((yield* status.get(chat.id)).type).toBe("idle")
    }),
  3_000,
)

// Cancel semantics

it.instance("cancel interrupts loop and resolves with an assistant message", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* seed(chat.id)

    yield* llm.hang

    yield* user(chat.id, "more")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)
    yield* prompt.cancel(chat.id)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.info.role).toBe("assistant")
    }
  }),
)

it.instance("cancel records MessageAbortedError on interrupted process", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.hang
    yield* user(chat.id, "hello")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)
    yield* prompt.cancel(chat.id)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const info = exit.value.info
      if (info.role === "assistant") {
        expect(info.error?.name).toBe("MessageAbortedError")
      }
    }
  }),
)

raceNoLLMServer.instance(
  "finalizes assistant when cancelled before processor creation completes",
  () =>
    Effect.gen(function* () {
      processorCreateStarted.length = 0
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          processorCreateStarted.length = 0
        }),
      )

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Processor creation race" })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "first" }],
      })

      const firstCreate = defer<void>()
      processorCreateStarted.push(firstCreate.resolve)
      const first = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.promise(() => firstCreate.promise)

      yield* prompt.cancel(chat.id)
      const firstExit = yield* Fiber.await(first)
      expect(Exit.isSuccess(firstExit)).toBe(true)

      let messages = yield* sessions.messages({ sessionID: chat.id })
      const firstInterrupted = messages.at(-1)
      expect(firstInterrupted?.info.role).toBe("assistant")
      expect(firstInterrupted?.parts).toHaveLength(0)
      if (firstInterrupted?.info.role === "assistant") {
        expect(firstInterrupted.info.finish).toBeUndefined()
        expect(firstInterrupted.info.time.completed).toBeNumber()
        expect(firstInterrupted.info.error?.name).toBe("MessageAbortedError")
      }

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "second" }],
      })

      const secondCreate = defer<void>()
      processorCreateStarted.push(secondCreate.resolve)
      const second = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.promise(() => secondCreate.promise)

      yield* prompt.cancel(chat.id)
      const secondExit = yield* Fiber.await(second)
      expect(Exit.isSuccess(secondExit)).toBe(true)

      messages = yield* sessions.messages({ sessionID: chat.id })
      const poisonMessages = messages.filter(
        (message) =>
          message.info.role === "assistant" &&
          message.parts.length === 0 &&
          !message.info.finish &&
          !message.info.time.completed &&
          !message.info.error,
      )
      expect(poisonMessages).toHaveLength(0)

      const interruptedMessages = messages.filter(
        (message) =>
          message.info.role === "assistant" &&
          message.parts.length === 0 &&
          message.info.time.completed &&
          message.info.error?.name === "MessageAbortedError",
      )
      expect(interruptedMessages).toHaveLength(2)

      const lastUser = messages.at(-2)
      const lastAssistant = messages.at(-1)
      expect(lastUser?.info.role).toBe("user")
      expect(lastAssistant?.info.role).toBe("assistant")
      if (lastUser?.info.role === "user" && lastAssistant?.info.role === "assistant") {
        expect(lastAssistant.info.parentID).toBe(lastUser?.info.id)
      }
    }),
  { config: cfg },
  3_000,
)

noLLMServer.instance(
  "cancel finalizes subtask tool state",
  () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const aborted = yield* Deferred.make<void>()
      const registry = yield* ToolRegistry.Service
      const { task } = yield* registry.named()
      const original = task.execute
      task.execute = (_args, ctx) =>
        Effect.callback<never>((_resume) => {
          ctx.abort.addEventListener("abort", () => succeedVoid(aborted), { once: true })
          if (ctx.abort.aborted) succeedVoid(aborted)
          succeedVoid(ready)
          return Effect.sync(() => succeedVoid(aborted))
        })
      yield* Effect.addFinalizer(() => Effect.sync(() => void (task.execute = original)))

      const { prompt, chat } = yield* boot()
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for task tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
      yield* awaitWithTimeout(Deferred.await(aborted), "timed out waiting for task tool abort", "10 seconds")

      const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
      const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
      expect(taskMsg?.info.role).toBe("assistant")
      if (!taskMsg || taskMsg.info.role !== "assistant") return

      const tool = toolPart(taskMsg.parts)
      expect(tool?.type).toBe("tool")
      if (!tool) return

      expect(tool.state.status).not.toBe("running")
      expect(taskMsg.info.time.completed).toBeDefined()
      expect(taskMsg.info.finish).toBeDefined()
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "cancel propagates from slash command subtask to child session",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const status = yield* SessionStatus.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)

      const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
      const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
      const tool = taskMsg ? toolPart(taskMsg.parts) : undefined
      const sessionID = tool?.state.status === "running" ? tool.state.metadata?.sessionId : undefined
      expect(typeof sessionID).toBe("string")
      if (typeof sessionID !== "string") throw new Error("missing child session id")
      const childID = SessionID.make(sessionID)
      expect((yield* status.get(childID)).type).toBe("busy")

      yield* prompt.cancel(chat.id)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)

      expect((yield* status.get(chat.id)).type).toBe("idle")
      expect((yield* status.get(childID)).type).toBe("idle")
    }),
  10_000,
)

it.instance(
  "cancel with queued callers resolves all cleanly",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const a = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      const b = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      yield* prompt.cancel(chat.id)
      const [exitA, exitB] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
      expect(Exit.isSuccess(exitA)).toBe(true)
      expect(Exit.isSuccess(exitB)).toBe(true)
      if (Exit.isSuccess(exitA) && Exit.isSuccess(exitB)) {
        expect(exitA.value.info.id).toBe(exitB.value.info.id)
      }
    }),
  { git: true },
  10_000,
)

// Queue semantics

noLLMServer.instance("concurrent loop callers get same result", () =>
  Effect.gen(function* () {
    const { prompt, run, chat } = yield* boot()
    yield* seed(chat.id, { finish: "stop" })

    const [a, b] = yield* Effect.all([prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })], {
      concurrency: "unbounded",
    })

    expect(a.info.id).toBe(b.info.id)
    expect(a.info.role).toBe("assistant")
    yield* run.assertNotBusy(chat.id)
  }),
)

it.instance("concurrent loop callers all receive same error result", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.fail("boom")
    yield* user(chat.id, "hello")

    const [a, b] = yield* Effect.all([prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })], {
      concurrency: "unbounded",
    })
    expect(a.info.id).toBe(b.info.id)
    expect(a.info.role).toBe("assistant")
  }),
)

it.instance("prompt submitted during an active run is included in the next LLM input", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const gate = yield* Deferred.make<void>()
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.hold("first", deferredAsPromise(gate))
    yield* llm.text("second")

    const a = yield* prompt
      .prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "first" }],
      })
      .pipe(Effect.forkChild)

    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const id = MessageID.ascending()
    const b = yield* prompt
      .prompt({
        sessionID: chat.id,
        messageID: id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "second" }],
      })
      .pipe(Effect.forkChild)

    yield* pollWithTimeout(
      sessions
        .messages({ sessionID: chat.id })
        .pipe(
          Effect.map((msgs) => (msgs.some((msg) => msg.info.role === "user" && msg.info.id === id) ? true : undefined)),
        ),
      "timed out waiting for second prompt to save",
    )

    yield* Deferred.succeed(gate, void 0)

    const [ea, eb] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
    expect(Exit.isSuccess(ea)).toBe(true)
    expect(Exit.isSuccess(eb)).toBe(true)
    expect(yield* llm.calls).toBe(2)

    const msgs = yield* sessions.messages({ sessionID: chat.id })
    const assistants = msgs.filter((msg) => msg.info.role === "assistant")
    expect(assistants).toHaveLength(2)
    const last = assistants.at(-1)
    if (!last || last.info.role !== "assistant") throw new Error("expected second assistant")
    expect(last.info.parentID).toBe(id)
    expect(last.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)

    const inputs = yield* llm.inputs
    expect(inputs).toHaveLength(2)
    const messages = inputs.at(-1)?.messages
    if (!Array.isArray(messages)) throw new Error("expected LLM messages")
    expect(messages.at(-1)).toEqual({ role: "user", content: "second" })
  }),
)

it.instance("assertNotBusy fails with BusyError when loop running", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const run = yield* SessionRunState.Service
    const sessions = yield* Session.Service
    yield* llm.hang

    const chat = yield* sessions.create({})
    yield* user(chat.id, "hi")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const exit = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
      expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "SessionBusyError", sessionID: chat.id })
    }

    yield* prompt.cancel(chat.id)
    yield* Fiber.await(fiber)
  }),
)

noLLMServer.instance("assertNotBusy succeeds when idle", () =>
  Effect.gen(function* () {
    const run = yield* SessionRunState.Service
    const sessions = yield* Session.Service

    const chat = yield* sessions.create({})
    const exit = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
    expect(Exit.isSuccess(exit)).toBe(true)
  }),
)

// Shell semantics

it.instance("shell rejects with BusyError when loop running", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.hang
    yield* user(chat.id, "hi")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const exit = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "echo hi" }).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
      expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "SessionBusyError", sessionID: chat.id })
    }

    yield* prompt.cancel(chat.id)
    yield* Fiber.await(fiber)
  }),
)

unixNoLLMServer(
  "shell captures stdout and stderr in completed tool output",
  () =>
    Effect.gen(function* () {
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "printf out && printf err >&2",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.output).toContain("out")
      expect(tool.state.output).toContain("err")
      expect(tool.state.metadata.output).toContain("out")
      expect(tool.state.metadata.output).toContain("err")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell completes a fast command on the preferred shell",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "pwd",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.input.command).toBe("pwd")
      expect(tool.state.output).toContain(dir)
      expect(tool.state.metadata.output).toContain(dir)
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell uses configured shell over env shell",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        if (!(yield* hasBash)) return

        const { prompt, chat } = yield* boot()
        const result = yield* prompt.shell({
          sessionID: chat.id,
          agent: "build",
          command: "[[ 1 -eq 1 ]] && printf configured",
        })

        const tool = completedTool(result.parts)
        if (!tool) return
        expect(tool.state.output).toContain("configured")
      }),
    ),
  { config: { ...cfg, shell: "bash" } },
  30_000,
)

unixNoLLMServer(
  "shell commands can change directory after startup",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const { prompt, run, chat } = yield* boot()
        const parent = path.dirname(dir)
        const result = yield* prompt.shell({
          sessionID: chat.id,
          agent: "build",
          command: "cd .. && pwd",
        })

        expect(result.info.role).toBe("assistant")
        const tool = completedTool(result.parts)
        if (!tool) return

        expect(tool.state.output).toContain(parent)
        expect(tool.state.metadata.output).toContain(parent)
        yield* run.assertNotBusy(chat.id)
      }),
    ),
  { config: cfg },
)

unixNoLLMServer(
  "shell lists files from the project directory",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const { prompt, run, chat } = yield* boot()
      yield* writeText(path.join(dir, "README.md"), "# e2e\n")

      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "command ls",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.input.command).toBe("command ls")
      expect(tool.state.output).toContain("README.md")
      expect(tool.state.metadata.output).toContain("README.md")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell captures stderr from a failing command",
  () =>
    Effect.gen(function* () {
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "command -v __nonexistent_cmd_e2e__ || echo 'not found' >&2; exit 1",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.output).toContain("not found")
      expect(tool.state.metadata.output).toContain("not found")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell updates running metadata before process exit",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()

        const fiber = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: "printf first && sleep 0.2 && printf second" })
          .pipe(Effect.forkChild)

        yield* pollWithTimeout(
          Effect.gen(function* () {
            const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
            const taskMsg = msgs.find((item) => item.info.role === "assistant")
            const tool = taskMsg ? toolPart(taskMsg.parts) : undefined
            if (tool?.state.status === "running" && tool.state.metadata?.output.includes("first")) return true
          }),
          "timed out waiting for running shell metadata",
        )

        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
      }),
    ),
  { config: cfg },
  30_000,
)

it.instance(
  "loop waits while shell runs and starts after shell exits",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.text("after-shell")

      const sh = yield* prompt
        .shell({ sessionID: chat.id, agent: "build", command: "sleep 0.2" })
        .pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const loop = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      expect(yield* llm.calls).toBe(0)

      yield* Fiber.await(sh)
      const exit = yield* Fiber.await(loop)

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.info.role).toBe("assistant")
        expect(exit.value.parts.some((part) => part.type === "text" && part.text === "after-shell")).toBe(true)
      }
      expect(yield* llm.calls).toBe(1)
    }),
  { git: true },
  10_000,
)

it.instance(
  "shell completion resumes queued loop callers",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.text("done")

      const sh = yield* prompt
        .shell({ sessionID: chat.id, agent: "build", command: "sleep 0.2" })
        .pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const a = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      const b = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      expect(yield* llm.calls).toBe(0)

      yield* Fiber.await(sh)
      const [ea, eb] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])

      expect(Exit.isSuccess(ea)).toBe(true)
      expect(Exit.isSuccess(eb)).toBe(true)
      if (Exit.isSuccess(ea) && Exit.isSuccess(eb)) {
        expect(ea.value.info.id).toBe(eb.value.info.id)
        expect(ea.value.info.role).toBe("assistant")
      }
      expect(yield* llm.calls).toBe(1)
    }),
  { git: true },
  10_000,
)

unix(
  "command ! expansion uses configured shell over env shell",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        if (!(yield* hasBash)) return
        const { llm } = yield* useServerConfig((url) => ({
          ...providerCfg(url),
          shell: "bash",
          command: {
            probe: {
              template: "Probe: !`[[ 1 -eq 1 ]] && printf configured`",
            },
          },
        }))

        const { prompt, chat } = yield* boot()
        yield* llm.text("done")

        const result = yield* prompt.command({
          sessionID: chat.id,
          command: "probe",
          arguments: "",
        })

        expect(result.info.role).toBe("assistant")
        const inputs = yield* llm.inputs
        expect(JSON.stringify(inputs.at(-1)?.messages)).toContain("configured")
      }),
    ),
  30_000,
)

unixNoLLMServer(
  "cancel interrupts shell and resolves cleanly",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, run, chat } = yield* boot()
        const { directory: dir } = yield* TestInstance
        const afs = yield* FSUtil.Service
        const ready = path.join(dir, ".shell-ready")

        const sh = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: ": > '.shell-ready'; sleep 30" })
          .pipe(Effect.forkChild)
        yield* pollWithTimeout(
          afs.existsSafe(ready).pipe(Effect.map((exists) => (exists ? (true as const) : undefined))),
          "shell never created readiness marker",
        )

        yield* prompt.cancel(chat.id)

        const status = yield* SessionStatus.Service
        expect((yield* status.get(chat.id)).type).toBe("idle")
        const busy = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
        expect(Exit.isSuccess(busy)).toBe(true)

        const exit = yield* Fiber.await(sh)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          expect(exit.value.info.role).toBe("assistant")
          const tool = completedTool(exit.value.parts)
          if (tool) {
            expect(tool.state.output).toContain("User aborted the command")
          }
        }
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

unixNoLLMServer(
  "cancel persists aborted shell result when shell ignores TERM",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()
        const { directory: dir } = yield* TestInstance
        const afs = yield* FSUtil.Service
        const ready = path.join(dir, ".trap-ready")

        const sh = yield* prompt
          .shell({
            sessionID: chat.id,
            agent: "build",
            // Touch marker AFTER trap installs so the test waits for the actual
            // ignore-TERM state before cancelling; otherwise SIGTERM can arrive
            // before `trap` runs and the escalation path is never exercised.
            command: `trap '' TERM; touch "${ready}"; sleep 30`,
          })
          .pipe(Effect.forkChild)

        yield* Effect.gen(function* () {
          while (!(yield* afs.existsSafe(ready))) {
            yield* Effect.sleep(Duration.millis(10))
          }
        }).pipe(Effect.timeout(Duration.seconds(5)))

        yield* prompt.cancel(chat.id)

        const exit = yield* Fiber.await(sh)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          expect(exit.value.info.role).toBe("assistant")
          const tool = completedTool(exit.value.parts)
          if (tool) {
            expect(tool.state.output).toContain("User aborted the command")
          }
        }
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

unix(
  "cancel finalizes interrupted bash tool output through normal truncation",
  () =>
    Effect.gen(function* () {
      const { dir, llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Interrupted bash truncation",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "run bash" }],
      })

      yield* llm.tool("bash", {
        command:
          'i=0; while [ "$i" -lt 4000 ]; do printf "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx %05d\\n" "$i"; i=$((i + 1)); done; printf truncation-ready; sleep 30',
        timeout: 30_000,
        workdir: path.resolve(dir),
      })

      const run = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const assistant = msgs.findLast((item) => item.info.role === "assistant")
          const tool = assistant ? toolPart(assistant.parts) : undefined
          if (tool?.state.status === "running" && tool.state.metadata?.output.includes("truncation-ready")) return true
        }),
        "timed out waiting for truncated shell output",
      )
      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(run)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isFailure(exit)) return

      const tool = completedTool(exit.value.parts)
      if (!tool) return

      expect(tool.state.metadata.truncated).toBe(true)
      expect(typeof tool.state.metadata.outputPath).toBe("string")
      expect(tool.state.output).toMatch(/\.\.\.output truncated\.\.\./)
      expect(tool.state.output).toMatch(/Full output saved to:\s+\S+/)
      expect(tool.state.output).not.toContain("Tool execution aborted")
    }),
  { git: true },
  30_000,
)

unixNoLLMServer(
  "cancel interrupts loop queued behind shell",
  () =>
    Effect.gen(function* () {
      const { prompt, chat } = yield* boot()

      const sh = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "sleep 30" }).pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const loop = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(loop)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const tool = completedTool(exit.value.parts)
        expect(tool?.state.output).toContain("User aborted the command")
      }

      yield* Fiber.await(sh)
    }),
  { git: true, config: cfg },
  30_000,
)

unixNoLLMServer(
  "shell rejects when another shell is already running",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()

        const a = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: "sleep 30" })
          .pipe(Effect.forkChild)
        yield* waitForBusy(chat.id)

        const exit = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "echo hi" }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
        }

        yield* prompt.cancel(chat.id)
        yield* Fiber.await(a)
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

// Abort signal propagation tests for inline tool execution

function hangUntilAborted(tool: { execute: (...args: any[]) => any }) {
  return Effect.gen(function* () {
    const ready = yield* Deferred.make<void>()
    const aborted = yield* Deferred.make<void>()
    const original = tool.execute
    tool.execute = (_args: any, ctx: any) => {
      ctx.abort.addEventListener("abort", () => succeedVoid(aborted), { once: true })
      if (ctx.abort.aborted) succeedVoid(aborted)
      succeedVoid(ready)
      return Effect.callback<never>(() => Effect.sync(() => succeedVoid(aborted)))
    }
    const restore = Effect.addFinalizer(() => Effect.sync(() => void (tool.execute = original)))
    return { ready, aborted, restore }
  })
}

noLLMServer.instance(
  "interrupt propagates abort signal to read tool via file part (text/plain)",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const registry = yield* ToolRegistry.Service
      const { read } = yield* registry.named()
      const { ready, restore } = yield* hangUntilAborted(read)
      yield* restore

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Abort Test" })

      const testFile = path.join(dir, "test.txt")
      yield* writeText(testFile, "hello world")

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [
            { type: "text", text: "read this" },
            { type: "file", url: `file://${testFile}`, filename: "test.txt", mime: "text/plain" },
          ],
        })
        .pipe(Effect.forkChild)

      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for read tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  { config: cfg },
  30_000,
)

noLLMServer.instance(
  "interrupt propagates abort signal to read tool via file part (directory)",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const registry = yield* ToolRegistry.Service
      const { read } = yield* registry.named()
      const { ready, restore } = yield* hangUntilAborted(read)
      yield* restore

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Abort Test" })

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [
            { type: "text", text: "read this" },
            { type: "file", url: `file://${dir}`, filename: "dir", mime: "application/x-directory" },
          ],
        })
        .pipe(Effect.forkChild)

      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for read tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  { config: cfg },
  30_000,
)

// Missing file handling

noLLMServer.instance(
  "does not fail the prompt when a file part is missing",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const missing = path.join(dir, "does-not-exist.ts")
      const msg = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [
          { type: "text", text: "please review @does-not-exist.ts" },
          {
            type: "file",
            mime: "text/plain",
            url: `file://${missing}`,
            filename: "does-not-exist.ts",
          },
        ],
      })

      if (msg.info.role !== "user") throw new Error("expected user message")
      const hasFailure = msg.parts.some(
        (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
      )
      expect(hasFailure).toBe(true)

      yield* sessions.remove(session.id)
    }),
  { config: cfg },
)

noLLMServer.instance(
  "keeps stored part order stable when file resolution is async",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const missing = path.join(dir, "still-missing.ts")
      const msg = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [
          {
            type: "file",
            mime: "text/plain",
            url: `file://${missing}`,
            filename: "still-missing.ts",
          },
          { type: "text", text: "after-file" },
        ],
      })

      if (msg.info.role !== "user") throw new Error("expected user message")

      const stored = yield* MessageV2.get({
        sessionID: session.id,
        messageID: msg.info.id,
      })
      const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

      expect(text[0]?.startsWith("Called the Read tool with the following input:")).toBe(true)
      expect(text[1]?.includes("Read tool failed to read")).toBe(true)
      expect(text[2]).toBe("after-file")

      yield* sessions.remove(session.id)
    }),
  { config: cfg },
)

// Special characters in filenames

noLLMServer.instance(
  "handles filenames with # character",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      yield* writeText(path.join(dir, "file#name.txt"), "special content\n")

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const parts = yield* prompt.resolvePromptParts("Read @file#name.txt")
      const fileParts = parts.filter((part) => part.type === "file")

      expect(fileParts.length).toBe(1)
      expect(fileParts[0].filename).toBe("file#name.txt")
      expect(fileParts[0].url).toContain("%23")

      const decodedPath = fileURLToPath(fileParts[0].url)
      expect(decodedPath).toBe(path.join(dir, "file#name.txt"))

      const message = yield* prompt.prompt({
        sessionID: session.id,
        parts,
        noReply: true,
      })
      const stored = yield* MessageV2.get({ sessionID: session.id, messageID: message.info.id })
      const textParts = stored.parts.filter((part) => part.type === "text")
      const hasContent = textParts.some((part) => part.text.includes("special content"))
      expect(hasContent).toBe(true)

      yield* sessions.remove(session.id)
    }),
  { git: true, config: cfg },
)

// Regression: empty assistant turn loop

it.instance("does not loop empty assistant turns for a simple reply", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt regression" })

    yield* llm.text("packages/prioricode/src/session/processor.ts")

    const result = yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      parts: [{ type: "text", text: "Where is SessionProcessor?" }],
    })

    expect(result.info.role).toBe("assistant")
    expect(result.parts.some((part) => part.type === "text" && part.text.includes("processor.ts"))).toBe(true)

    const msgs = yield* sessions.messages({ sessionID: session.id })
    expect(msgs.filter((msg) => msg.info.role === "assistant")).toHaveLength(1)
    expect(yield* llm.calls).toBe(1)
  }),
)

it.instance("records aborted errors when prompt is cancelled mid-stream", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt cancel regression" })

    yield* llm.hang

    const fiber = yield* prompt
      .prompt({
        sessionID: session.id,
        agent: "build",
        parts: [{ type: "text", text: "Cancel me" }],
      })
      .pipe(Effect.forkChild)

    yield* llm.wait(1)
    yield* waitForBusy(session.id)
    yield* prompt.cancel(session.id)

    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.info.role).toBe("assistant")
      if (exit.value.info.role === "assistant") {
        expect(exit.value.info.error?.name).toBe("MessageAbortedError")
      }
    }

    const msgs = yield* sessions.messages({ sessionID: session.id })
    const last = msgs.findLast((msg) => msg.info.role === "assistant")
    expect(last?.info.role).toBe("assistant")
    if (last?.info.role === "assistant") {
      expect(last.info.error?.name).toBe("MessageAbortedError")
    }
  }),
)

// Agent variant

noLLMServer.instance(
  "applies agent variant only when using agent model",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const other = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        model: { providerID: ProviderV2.ID.make("prioricode"), modelID: ModelV2.ID.make("kimi-k2.5-free") },
        noReply: true,
        parts: [{ type: "text", text: "hello" }],
      })
      if (other.info.role !== "user") throw new Error("expected user message")
      expect(other.info.model.variant).toBeUndefined()

      const match = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "hello again" }],
      })
      if (match.info.role !== "user") throw new Error("expected user message")
      expect(match.info.model).toEqual({
        providerID: ProviderV2.ID.make("test"),
        modelID: ModelV2.ID.make("test-model"),
        variant: "xhigh",
      })
      expect(match.info.model.variant).toBe("xhigh")

      const override = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        variant: "high",
        parts: [{ type: "text", text: "hello third" }],
      })
      if (override.info.role !== "user") throw new Error("expected user message")
      expect(override.info.model.variant).toBe("high")

      yield* sessions.remove(session.id)
    }),
  {
    config: {
      ...cfg,
      provider: {
        ...cfg.provider,
        test: {
          ...cfg.provider.test,
          models: {
            "test-model": {
              ...cfg.provider.test.models["test-model"],
              variants: { xhigh: {}, high: {} },
            },
          },
        },
      },
      agent: {
        build: {
          model: "test/test-model",
          variant: "xhigh",
        },
      },
    },
  },
)

// Agent / command resolution errors

noLLMServer.instance(
  "unknown agent throws typed error",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .prompt({
          sessionID: session.id,
          agent: "nonexistent-agent-xyz",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err).not.toBeInstanceOf(TypeError)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain('Agent not found: "nonexistent-agent-xyz"')
        }
      }
    }),
  30_000,
)

noLLMServer.instance(
  "unknown agent error includes available agent names",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .prompt({
          sessionID: session.id,
          agent: "nonexistent-agent-xyz",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain("build")
        }
      }
    }),
  30_000,
)

noLLMServer.instance(
  "unknown command throws typed error with available names",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .command({
          sessionID: session.id,
          command: "nonexistent-command-xyz",
          arguments: "",
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err).not.toBeInstanceOf(TypeError)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain('Command not found: "nonexistent-command-xyz"')
          expect(err.data.message).toContain("init")
        }
      }
    }),
  30_000,
)

const toolCtx = (sessionID: SessionID): Tool.Context => ({
  sessionID,
  messageID: MessageID.make("msg_coord_tool_test"),
  callID: "",
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

const setLastActive = Effect.fn("test.setLastActive")(function* (sessionID: SessionID, time: number) {
  const { db } = yield* Database.Service
  yield* db
    .update(SessionTable)
    .set({ time_updated: time })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)
})

// Age coordination rows directly so grace/recovery thresholds can be exercised
// without wall-clock sleeps (per test/AGENTS.md: synchronize on signals, not time).
const setCoordinationTimes = Effect.fn("test.setCoordinationTimes")(function* (
  id: string,
  times: { timeCreated?: number; timeRead?: number },
) {
  const { db } = yield* Database.Service
  yield* db
    .update(CoordinationTable)
    .set({
      ...(times.timeCreated === undefined ? {} : { time_created: times.timeCreated }),
      ...(times.timeRead === undefined ? {} : { time_read: times.timeRead }),
    })
    .where(eq(CoordinationTable.id, id))
    .run()
    .pipe(Effect.orDie)
})

describe("cross-session coordination", () => {
  coordinationIt.instance(
    "injects pending coordination notes into the model system context at the turn boundary",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const sender = yield* sessions.create({ title: "sender" })
        const chat = yield* sessions.create({
          title: "receiver",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* coordination.post({
          projectID: chat.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: chat.id,
          body: "PEER_NOTE_123",
        })

        yield* llm.hang
        yield* user(chat.id, "hello")
        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        yield* awaitWithTimeout(llm.wait(1), "timed out waiting for the coordination turn request", "10 seconds")

        const body = JSON.stringify((yield* llm.hits)[0]?.body)
        expect(body).toContain("Cross-session coordination")
        expect(body).toContain("PEER_NOTE_123")
        yield* Fiber.interrupt(fiber)
      }),
    15_000,
  )

  coordinationIt.instance(
    "claim-once: a note surfaced by context injection is not re-delivered on the next turn",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const sender = yield* sessions.create({ title: "sender" })
        const chat = yield* sessions.create({
          title: "receiver",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* coordination.post({
          projectID: chat.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: chat.id,
          body: "ONLY_ONCE_777",
        })

        yield* llm.text("first")
        yield* user(chat.id, "hello")
        yield* prompt.loop({ sessionID: chat.id })

        // The single pending note has now been consumed.
        expect(yield* coordination.inbox({ sessionID: chat.id, kinds: ["message"], unreadOnly: true })).toHaveLength(0)

        // A second turn must not re-surface it.
        yield* llm.text("second")
        yield* user(chat.id, "again")
        yield* prompt.loop({ sessionID: chat.id })

        const body = JSON.stringify((yield* llm.hits).at(-1)?.body)
        expect(body).not.toContain("ONLY_ONCE_777")
      }),
    20_000,
  )

  coordinationIt.instance(
    "sweep wakes an idle session with pending notes and delivers them durably",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const sender = yield* sessions.create({ title: "sender" })
        const target = yield* sessions.create({
          title: "target",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* coordination.post({
          projectID: target.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: target.id,
          body: "WAKE_NOTE_456",
        })

        yield* llm.text("ack")
        const woken = yield* watcher.sweep()
        expect(woken).toBe(1)

        // Delivered exactly once: the recipient's unread inbox is drained.
        expect(yield* coordination.inbox({ sessionID: target.id, kinds: ["message"], unreadOnly: true })).toHaveLength(
          0,
        )

        // The target ran a turn triggered by the generic wake message, and the note
        // body reached the model via the turn's system context (the single delivery point).
        const messages = yield* sessions.messages({ sessionID: target.id })
        const transcript = JSON.stringify(messages.map((message) => message.parts))
        expect(transcript).toContain(Coordination.wakePrompt)
        const requests = JSON.stringify((yield* llm.hits).map((hit) => hit.body))
        expect(requests).toContain("WAKE_NOTE_456")
        expect(yield* llm.calls).toBeGreaterThanOrEqual(1)
      }),
    20_000,
  )

  coordinationIt.instance(
    "sweep does not wake a session that is currently busy",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const sender = yield* sessions.create({ title: "sender" })
        const target = yield* sessions.create({
          title: "target",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Put the target into a busy turn that hangs on the LLM.
        yield* llm.hang
        yield* user(target.id, "working")
        const busy = yield* prompt.loop({ sessionID: target.id }).pipe(Effect.forkChild)
        yield* waitForBusy(target.id)

        yield* coordination.post({
          projectID: target.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: target.id,
          body: "DEFERRED_999",
        })

        // While busy, the poller must not start a second concurrent turn.
        const woken = yield* watcher.sweep()
        expect(woken).toBe(0)
        // The note stays queued for delivery at the next turn boundary.
        expect(yield* coordination.inbox({ sessionID: target.id, kinds: ["message"], unreadOnly: true })).toHaveLength(
          1,
        )

        yield* Fiber.interrupt(busy)
      }),
    20_000,
  )

  coordinationIt.instance(
    "send fails for an unknown target id without posting anything",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const caller = yield* sessions.create({ title: "caller" })
        const def = yield* Tool.init(yield* SessionsTool)

        const out = yield* def.execute(
          { action: "send", target: SessionID.make("ses_does_not_exist"), message: "hello" },
          toolCtx(caller.id),
        )
        expect(out.title).toBe("sessions:error")
        expect(out.output).toContain("never guess or invent session ids")

        // A hallucinated target must not create an orphan queued note.
        expect(
          yield* coordination.inbox({ sessionID: SessionID.make("ses_does_not_exist"), kinds: ["message"] }),
        ).toHaveLength(0)
      }),
    15_000,
  )

  coordinationIt.instance(
    "send to an archived sibling is refused",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const caller = yield* sessions.create({ title: "caller" })
        const archived = yield* sessions.create({ title: "archived peer" })
        yield* sessions.setArchived({ sessionID: archived.id, time: Date.now() })
        const def = yield* Tool.init(yield* SessionsTool)

        const out = yield* def.execute({ action: "send", target: archived.id, message: "hello" }, toolCtx(caller.id))
        expect(out.title).toBe("sessions:error")
        expect(out.output).toContain("archived")
      }),
    15_000,
  )

  coordinationIt.instance(
    "send posts durably to a recent sibling and states honest delivery + receipt semantics",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const caller = yield* sessions.create({ title: "caller" })
        const peer = yield* sessions.create({ title: "recent peer" })
        const def = yield* Tool.init(yield* SessionsTool)

        const out = yield* def.execute({ action: "send", target: peer.id, message: "COORD_SEND_1" }, toolCtx(caller.id))
        expect(out.output).toContain("queued")
        expect(out.output).toContain("wakes within seconds")
        expect(out.output).toContain("Receipt: discover")
        expect(out.output).not.toContain("WARNING")

        const unread = yield* coordination.inbox({ sessionID: peer.id, kinds: ["message"], unreadOnly: true })
        expect(unread.map((item) => item.body)).toEqual(["COORD_SEND_1"])
      }),
    15_000,
  )

  coordinationIt.instance(
    "send to a stale sibling still posts but warns the sender",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const caller = yield* sessions.create({ title: "caller" })
        const stale = yield* sessions.create({ title: "stale peer" })
        yield* setLastActive(stale.id, Date.now() - 8 * 24 * 60 * 60 * 1000)
        const def = yield* Tool.init(yield* SessionsTool)

        const out = yield* def.execute({ action: "send", target: stale.id, message: "COORD_STALE" }, toolCtx(caller.id))
        expect(out.output).toContain("WARNING")
        expect(out.output).toContain("abandoned")
        expect(yield* coordination.inbox({ sessionID: stale.id, kinds: ["message"], unreadOnly: true })).toHaveLength(1)
      }),
    15_000,
  )

  coordinationIt.instance(
    "discover labels sibling recency and flags stale sessions",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const caller = yield* sessions.create({ title: "caller" })
        const fresh = yield* sessions.create({ title: "fresh peer" })
        const stale = yield* sessions.create({ title: "stale peer" })
        yield* setLastActive(stale.id, Date.now() - 8 * 24 * 60 * 60 * 1000)
        const def = yield* Tool.init(yield* SessionsTool)

        const out = yield* def.execute({ action: "discover" }, toolCtx(caller.id))
        expect(out.output).toContain(`${fresh.id} "fresh peer"`)
        expect(out.output).toContain("last active")
        expect(out.output).toContain(`${stale.id} "stale peer"`)
        const staleLine = out.output.split("\n").find((line) => line.includes(stale.id))
        expect(staleLine).toContain("STALE")
        const freshLine = out.output.split("\n").find((line) => line.includes(fresh.id))
        expect(freshLine).not.toContain("STALE")
      }),
    15_000,
  )
})

const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe("cross-session coordination stress", () => {
  coordinationIt.instance(
    "concurrent claimUnread partitions notes exactly once",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const sender = yield* sessions.create({ title: "sender" })
        const target = yield* sessions.create({ title: "target" })
        for (let i = 0; i < 20; i++) {
          yield* coordination.post({
            projectID: target.projectID,
            kind: "message",
            fromSession: sender.id,
            toSession: target.id,
            body: `RACE_NOTE_${i}`,
          })
        }
        const claims = yield* Effect.all(
          Array.from({ length: 10 }, () => coordination.claimUnread(target.id)),
          { concurrency: "unbounded" },
        )
        const all = claims.flat()
        expect(all).toHaveLength(20)
        expect(new Set(all.map((item) => item.id)).size).toBe(20)
        expect(yield* coordination.inbox({ sessionID: target.id, kinds: ["message"], unreadOnly: true })).toHaveLength(
          0,
        )
      }),
    15_000,
  )

  coordinationIt.instance(
    "repeated sweeps deliver every note exactly once and the model sees each",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const sender = yield* sessions.create({ title: "sender" })
        const targets: Session.Info[] = []
        for (let t = 0; t < 5; t++) {
          targets.push(
            yield* sessions.create({
              title: `target-${t}`,
              permission: [{ permission: "*", pattern: "*", action: "allow" }],
            }),
          )
        }
        const post = (t: number, i: number) =>
          coordination.post({
            projectID: targets[t].projectID,
            kind: "message",
            fromSession: sender.id,
            toSession: targets[t].id,
            body: `S2_T${t}_N${i}`,
          })

        for (let t = 0; t < 5; t++) yield* post(t, 0)
        yield* watcher.sweep()
        for (let t = 0; t < 5; t++) {
          yield* post(t, 1)
          yield* post(t, 2)
        }
        yield* watcher.sweep()
        yield* watcher.sweep()

        for (let t = 0; t < 5; t++) {
          expect(
            yield* coordination.inbox({ sessionID: targets[t].id, kinds: ["message"], unreadOnly: true }),
          ).toHaveLength(0)
          // Each target was woken (generic trigger in the transcript).
          const messages = yield* sessions.messages({ sessionID: targets[t].id })
          const transcript = JSON.stringify(messages.map((message) => message.parts))
          expect(transcript).toContain(Coordination.wakePrompt)
        }
        // Each note reached the model's system context exactly once (single delivery point).
        const requests = JSON.stringify((yield* llm.hits).map((hit) => hit.body))
        for (let t = 0; t < 5; t++)
          for (let i = 0; i < 3; i++) expect(countOccurrences(requests, `S2_T${t}_N${i}`)).toBe(1)
      }),
    30_000,
  )

  coordinationIt.instance(
    "parallel sweeps never deliver a note twice and drain every inbox",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const sender = yield* sessions.create({ title: "sender" })
        const targets: Session.Info[] = []
        for (let t = 0; t < 4; t++) {
          targets.push(
            yield* sessions.create({
              title: `race-${t}`,
              permission: [{ permission: "*", pattern: "*", action: "allow" }],
            }),
          )
        }
        for (let t = 0; t < 4; t++)
          for (let i = 0; i < 3; i++)
            yield* coordination.post({
              projectID: targets[t].projectID,
              kind: "message",
              fromSession: sender.id,
              toSession: targets[t].id,
              body: `P_T${t}_N${i}`,
            })

        // Simulates two instances sweeping the same project at once.
        yield* Effect.all([watcher.sweep(), watcher.sweep(), watcher.sweep(), watcher.sweep()], {
          concurrency: "unbounded",
        })

        for (let t = 0; t < 4; t++) {
          expect(
            yield* coordination.inbox({ sessionID: targets[t].id, kinds: ["message"], unreadOnly: true }),
          ).toHaveLength(0)
          const messages = yield* sessions.messages({ sessionID: targets[t].id })
          const transcript = JSON.stringify(messages.map((message) => message.parts))
          expect(transcript).toContain(Coordination.wakePrompt)
        }
        // Each note reached the model's system context exactly once despite 4 racing sweeps.
        const requests = JSON.stringify((yield* llm.hits).map((hit) => hit.body))
        for (let t = 0; t < 4; t++)
          for (let i = 0; i < 3; i++) expect(countOccurrences(requests, `P_T${t}_N${i}`)).toBe(1)
        expect(yield* llm.calls).toBeGreaterThanOrEqual(4)
      }),
    30_000,
  )

  coordinationIt.instance(
    "a note posted mid-turn gets its own follow-up turn via the re-check loop",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const sender = yield* sessions.create({ title: "sender" })
        const target = yield* sessions.create({
          title: "target",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // First note triggers a wake whose model call we hold open past the boundary claim.
        yield* coordination.post({
          projectID: target.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: target.id,
          body: "MIDTURN_A",
        })
        let resolveHold: () => void = () => {}
        const holdPromise = new Promise<void>((resolve) => {
          resolveHold = resolve
        })
        yield* llm.hold("done-a", holdPromise)
        yield* llm.push(reply().text("done-b"))

        const sweepFiber = yield* watcher.sweep().pipe(Effect.forkChild)
        // Wait until the wake turn's model call is in flight (past the boundary claim).
        yield* awaitWithTimeout(llm.wait(1), "wake turn never reached the model", "10 seconds")

        // Second note arrives while the first turn is still running.
        yield* coordination.post({
          projectID: target.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: target.id,
          body: "MIDTURN_B",
        })

        // Release the first turn; the re-check loop must then wake a follow-up turn for B.
        resolveHold()
        const exit = yield* Fiber.await(sweepFiber)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) expect(exit.value).toBe(1)

        expect(yield* coordination.inbox({ sessionID: target.id, kinds: ["message"], unreadOnly: true })).toHaveLength(
          0,
        )
        const requests = JSON.stringify((yield* llm.hits).map((hit) => hit.body))
        expect(countOccurrences(requests, "MIDTURN_A")).toBe(1)
        expect(countOccurrences(requests, "MIDTURN_B")).toBe(1)
      }),
    30_000,
  )

  coordinationIt.instance(
    "parallel asks each receive exactly their own response",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const def = yield* Tool.init(yield* SessionsTool)
        const sender = yield* sessions.create({ title: "asker" })
        const target = yield* sessions.create({ title: "answerer" })

        const asks = Array.from({ length: 5 }, (_, i) =>
          def.execute({ action: "ask", target: target.id, message: `Q_${i}`, timeout: 20 }, toolCtx(sender.id)),
        )
        const fiber = yield* Effect.all(asks, { concurrency: "unbounded" }).pipe(Effect.forkChild)

        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const items = yield* coordination.inbox({ sessionID: target.id, kinds: ["request"], unreadOnly: true })
            return items.length === 5 ? items : undefined
          }),
          "all five requests never arrived in the target inbox",
          "10 seconds",
        )
        yield* Effect.forEach(
          pending,
          (request) =>
            coordination.post({
              projectID: target.projectID,
              kind: "response",
              fromSession: target.id,
              toSession: sender.id,
              body: `A_${request.body}`,
              replyTo: request.id,
            }),
          { concurrency: "unbounded" },
        )

        const results = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(results)).toBe(true)
        if (Exit.isSuccess(results)) {
          results.value.forEach((out, i) => {
            expect(out.output).toContain(`Response from ${target.id}`)
            expect(out.output).toContain(`A_Q_${i}`)
          })
        }
      }),
    30_000,
  )

  coordinationIt.instance(
    "parallel sends validate targets independently",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const def = yield* Tool.init(yield* SessionsTool)
        const caller = yield* sessions.create({ title: "caller" })
        const real = yield* sessions.create({ title: "real peer" })

        const results = yield* Effect.all(
          Array.from({ length: 10 }, (_, i) =>
            def.execute(
              i % 2 === 0
                ? { action: "send", target: SessionID.make(`ses_missing_${i}`), message: `M_${i}` }
                : { action: "send", target: real.id, message: `M_${i}` },
              toolCtx(caller.id),
            ),
          ),
          { concurrency: "unbounded" },
        )
        const errors = results.filter((result) => result.title === "sessions:error")
        const ok = results.filter((result) => result.title !== "sessions:error")
        expect(errors).toHaveLength(5)
        expect(ok).toHaveLength(5)
        for (const result of errors) expect(result.output).toContain("never guess or invent session ids")
        expect(yield* coordination.inbox({ sessionID: real.id, kinds: ["message"], unreadOnly: true })).toHaveLength(5)
      }),
    15_000,
  )

  coordinationIt.instance(
    "the periodic watcher wakes an idle session without any manual sweep",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const sender = yield* sessions.create({ title: "sender" })
        const target = yield* sessions.create({
          title: "sleeper",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Start the real 2s poll loop for this instance, then just post a note.
        yield* watcher.init()
        yield* coordination.post({
          projectID: target.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: target.id,
          body: "PERIODIC_WAKE_1",
        })

        // Wait until the periodic watcher woke the session and the model saw the note.
        yield* pollWithTimeout(
          Effect.gen(function* () {
            const hits = yield* llm.hits
            return hits.some((hit) => JSON.stringify(hit.body).includes("PERIODIC_WAKE_1")) ? true : undefined
          }),
          "the periodic watcher never delivered the note to the model",
          "15 seconds",
        )
        expect(yield* coordination.inbox({ sessionID: target.id, kinds: ["message"], unreadOnly: true })).toHaveLength(
          0,
        )
        const messages = yield* sessions.messages({ sessionID: target.id })
        const transcript = JSON.stringify(messages.map((message) => message.parts))
        expect(transcript).toContain(Coordination.wakePrompt)
      }),
    30_000,
  )

  coordinationIt.instance(
    "a note consumed by a clean model step is acked in the ledger",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const sender = yield* sessions.create({ title: "sender" })
        const chat = yield* sessions.create({
          title: "receiver",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        const note = yield* coordination.post({
          projectID: chat.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: chat.id,
          body: "ACK_LEDGER_OK",
        })
        yield* llm.text("noted")
        yield* user(chat.id, "hello")
        yield* prompt.loop({ sessionID: chat.id })

        const row = yield* coordination.get(note.id)
        expect(row?.timeRead).toBeNumber()
        expect(row?.timeAck).toBeNumber()
        // The claim token is the step's assistant message id, recorded for audit.
        expect(row?.claimedBy).toBeString()
      }),
    20_000,
  )

  coordinationIt.instance(
    "a claim whose model request never completed stays read-but-unacked (recovery fuel)",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const sender = yield* sessions.create({ title: "sender" })
        const chat = yield* sessions.create({
          title: "receiver",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        const note = yield* coordination.post({
          projectID: chat.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: chat.id,
          body: "ACK_LEDGER_LOST",
        })

        // The turn claims the note into its request and hangs at the provider.
        yield* llm.hang
        yield* user(chat.id, "hello")
        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        yield* awaitWithTimeout(llm.wait(1), "the turn never reached the model", "10 seconds")

        const row = yield* coordination.get(note.id)
        expect(row?.timeRead).toBeNumber()
        expect(row?.timeAck).toBeUndefined()
        yield* Fiber.interrupt(fiber)
        // Interrupting does not retro-ack either.
        expect((yield* coordination.get(note.id))?.timeAck).toBeUndefined()
      }),
    20_000,
  )
})

describe("coordination ack-ledger recovery", () => {
  const allowAll = [{ permission: "*", pattern: "*", action: "allow" }] as const
  const AGED_MS = 16 * 60_000 // past the watcher's 15-minute recovery grace

  coordinationIt.instance(
    "recovery re-queues an injected-but-never-acked claim and the note is re-delivered and acked",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const sender = yield* sessions.create({ title: "sender" })
        const target = yield* sessions.create({ title: "zombie", permission: [...allowAll] })
        const note = yield* coordination.post({
          projectID: target.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: target.id,
          body: "RECOVER_ME_1",
        })
        // Simulate a turn that claimed the note into its request and then died
        // before the model step completed: read, never acked.
        const claimed = yield* coordination.claimUnread(target.id, undefined, { claimToken: "msg_crashed" })
        expect(claimed.map((item) => item.id)).toEqual([note.id])
        yield* setCoordinationTimes(note.id, { timeRead: Date.now() - AGED_MS })

        yield* llm.text("recovered")
        const woken = yield* watcher.sweep()
        expect(woken).toBe(1)

        const row = yield* coordination.get(note.id)
        expect(row?.timeRead).toBeNumber()
        expect(row?.timeAck).toBeNumber()
        expect(row?.claimedBy).not.toBe("msg_crashed")
        const requests = JSON.stringify((yield* llm.hits).map((hit) => hit.body))
        expect(requests).toContain("RECOVER_ME_1")
      }),
    20_000,
  )

  coordinationIt.instance(
    "recovery leaves fresh unacked claims and acked rows alone",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const sender = yield* sessions.create({ title: "sender" })
        const target = yield* sessions.create({ title: "steady", permission: [...allowAll] })
        const fresh = yield* coordination.post({
          projectID: target.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: target.id,
          body: "LIVE_STEP_CLAIM",
        })
        const settled = yield* coordination.post({
          projectID: target.projectID,
          kind: "message",
          fromSession: sender.id,
          toSession: target.id,
          body: "ALREADY_ACKED",
        })
        // fresh: claimed moments ago (a live step may still ack it).
        // settled: claimed long ago but properly acked.
        const claimed = yield* coordination.claimUnread(target.id, undefined, { claimToken: "msg_live" })
        expect(claimed).toHaveLength(2)
        yield* coordination.markAck([settled.id], "msg_live")
        yield* setCoordinationTimes(settled.id, { timeRead: Date.now() - AGED_MS })

        const woken = yield* watcher.sweep()
        expect(woken).toBe(0)
        expect((yield* coordination.get(fresh.id))?.claimedBy).toBe("msg_live")
        expect((yield* coordination.get(settled.id))?.timeRead).toBeNumber()
        expect((yield* coordination.get(settled.id))?.timeAck).toBeNumber()
        expect(yield* llm.calls).toBe(0)
      }),
    20_000,
  )

  coordinationIt.instance(
    "child sessions are never wake targets — notes addressed to them stay queued",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const parent = yield* sessions.create({ title: "parent" })
        const child = yield* sessions.create({ title: "task child", parentID: parent.id })
        yield* coordination.post({
          projectID: child.projectID,
          kind: "message",
          fromSession: parent.id,
          toSession: child.id,
          body: "FOR_CHILD_ONLY",
        })
        const woken = yield* watcher.sweep()
        expect(woken).toBe(0)
        expect(yield* coordination.inbox({ sessionID: child.id, kinds: ["message"], unreadOnly: true })).toHaveLength(1)
        expect(yield* llm.calls).toBe(0)
      }),
    20_000,
  )

  coordinationIt.instance(
    "a late reply to a timed-out ask wakes the asker and renders as informational",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const asker = yield* sessions.create({ title: "asker", permission: [...allowAll] })
        const answerer = yield* sessions.create({ title: "answerer" })
        yield* coordination.post({
          projectID: asker.projectID,
          kind: "response",
          fromSession: answerer.id,
          toSession: asker.id,
          body: "LATE_REPLY_X",
          replyTo: "coo_old_request",
        })

        yield* llm.text("ok")
        const woken = yield* watcher.sweep()
        expect(woken).toBe(1)
        const requests = JSON.stringify((yield* llm.hits).map((hit) => hit.body))
        expect(requests).toContain("LATE_REPLY_X")
        expect(requests).toContain("do not reply to this note")
      }),
    20_000,
  )

  coordinationIt.instance(
    "response-only wakes respect the cooldown so replies cannot ping-pong turns",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const asker = yield* sessions.create({ title: "asker", permission: [...allowAll] })
        const answerer = yield* sessions.create({ title: "answerer" })
        const first = yield* coordination.post({
          projectID: asker.projectID,
          kind: "response",
          fromSession: answerer.id,
          toSession: asker.id,
          body: "REPLY_ONE",
          replyTo: "coo_r1",
        })
        yield* llm.text("ok")
        yield* llm.text("ok")
        expect(yield* watcher.sweep()).toBe(1)

        // A second reply lands immediately after the wake turn: response-only,
        // inside the cooldown window — it must wait, not burn another turn.
        const second = yield* coordination.post({
          projectID: asker.projectID,
          kind: "response",
          fromSession: answerer.id,
          toSession: asker.id,
          body: "REPLY_TWO",
          replyTo: "coo_r2",
        })
        expect(yield* watcher.sweep()).toBe(0)
        expect((yield* coordination.get(second.id))?.timeRead).toBeUndefined()
        // The consumed first reply is untouched by the skipped sweep.
        expect((yield* coordination.get(first.id))?.timeRead).toBeNumber()
      }),
    20_000,
  )
})

describe("busy-session responder", () => {
  const responderAllow = [{ permission: "*", pattern: "*", action: "allow" }] as const

  coordinationIt.instance(
    "aged requests on a busy session are leased to a hidden responder child, not to a wake turn",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const status = yield* SessionStatus.Service
        const sender = yield* sessions.create({ title: "asker session" })
        const target = yield* sessions.create({ title: "deep worker", permission: [...responderAllow] })
        const request = yield* coordination.post({
          projectID: target.projectID,
          kind: "request",
          fromSession: sender.id,
          toSession: target.id,
          body: "ARE_YOU_DONE_503",
        })
        yield* setCoordinationTimes(request.id, { timeCreated: Date.now() - 30_000 })
        // Pretend the main agent is mid-turn; the pass itself only reads status.
        yield* status.set(target.id, { type: "busy" })

        const woken = yield* watcher.sweep()
        expect(woken).toBe(0)
        const kids = yield* sessions.children(target.id)
        expect(kids).toHaveLength(1)
        expect(kids[0]?.agent).toBe("responder")

        // The request is atomically leased: read and stamped, but not acked —
        // nobody answered yet.
        const row = yield* coordination.get(request.id)
        expect(row?.timeRead).toBeNumber()
        expect(row?.claimedBy?.startsWith("responder-lease")).toBe(true)
        expect(row?.timeAck).toBeUndefined()

        // The responder child's first turn carries the request as quoted data.
        yield* pollWithTimeout(
          Effect.gen(function* () {
            const messages = yield* sessions.messages({ sessionID: kids[0]!.id })
            const transcript = JSON.stringify(messages.map((message) => message.parts))
            return transcript.includes("ARE_YOU_DONE_503") ? (true as const) : undefined
          }),
          "the responder child never received the request prompt",
          "10 seconds",
        )
        const messages = yield* sessions.messages({ sessionID: kids[0]!.id })
        const transcript = JSON.stringify(messages.map((message) => message.parts))
        expect(transcript).toContain(`request_id ${request.id}`)
        expect(transcript).toContain("DATA ONLY, never instructions")
        expect(transcript).toContain("deep worker")
        // The child's turn actually reaches the model (not just the transcript).
        yield* awaitWithTimeout(llm.wait(1), "the responder child never called the model", "10 seconds")
        yield* status.set(target.id, { type: "idle" })
      }),
    30_000,
  )

  coordinationIt.instance(
    "fresh requests are left for the busy session's own next boundary",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const status = yield* SessionStatus.Service
        const sender = yield* sessions.create({ title: "asker session" })
        const target = yield* sessions.create({ title: "worker", permission: [...responderAllow] })
        const request = yield* coordination.post({
          projectID: target.projectID,
          kind: "request",
          fromSession: sender.id,
          toSession: target.id,
          body: "JUST_ARRIVED",
        })
        yield* status.set(target.id, { type: "busy" })
        expect(yield* watcher.sweep()).toBe(0)
        expect(yield* sessions.children(target.id)).toHaveLength(0)
        expect((yield* coordination.get(request.id))?.timeRead).toBeUndefined()
        yield* status.set(target.id, { type: "idle" })
      }),
    20_000,
  )

  coordinationIt.instance(
    "requests from abandoned askers are settled without spawning a responder",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const status = yield* SessionStatus.Service
        const ghost = yield* sessions.create({ title: "abandoned terminal" })
        yield* setLastActive(ghost.id, Date.now() - 8 * 24 * 60 * 60 * 1000)
        const target = yield* sessions.create({ title: "worker", permission: [...responderAllow] })
        const request = yield* coordination.post({
          projectID: target.projectID,
          kind: "request",
          fromSession: ghost.id,
          toSession: target.id,
          body: "GHOST_ASK",
        })
        yield* setCoordinationTimes(request.id, { timeCreated: Date.now() - 30_000 })
        yield* status.set(target.id, { type: "busy" })

        expect(yield* watcher.sweep()).toBe(0)
        expect(yield* sessions.children(target.id)).toHaveLength(0)
        const row = yield* coordination.get(request.id)
        // Settled in the ledger (acked) so recovery will never resurrect it.
        expect(row?.timeAck).toBeNumber()
        yield* status.set(target.id, { type: "idle" })
      }),
    20_000,
  )

  coordinationNoResponderIt.instance(
    "the kill-switch disables the responder pass without touching delivery",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const status = yield* SessionStatus.Service
        const sender = yield* sessions.create({ title: "asker session" })
        const target = yield* sessions.create({ title: "worker", permission: [...responderAllow] })
        const request = yield* coordination.post({
          projectID: target.projectID,
          kind: "request",
          fromSession: sender.id,
          toSession: target.id,
          body: "NO_RESPONDER",
        })
        yield* setCoordinationTimes(request.id, { timeCreated: Date.now() - 30_000 })
        yield* status.set(target.id, { type: "busy" })

        expect(yield* watcher.sweep()).toBe(0)
        expect(yield* sessions.children(target.id)).toHaveLength(0)
        // Still queued untouched for the main agent's own next boundary.
        expect((yield* coordination.get(request.id))?.timeRead).toBeUndefined()
        yield* status.set(target.id, { type: "idle" })
      }),
    20_000,
  )
})

describe("sessions tool receipts and delegation", () => {
  const receiptsAllow = [{ permission: "*", pattern: "*", action: "allow" }] as const

  coordinationIt.instance(
    "end to end: a peer's ask is answered by the busy target's responder and the parent learns via a record",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const watcher = yield* CoordinationWatcher.Service
        const status = yield* SessionStatus.Service
        const def = yield* Tool.init(yield* SessionsTool)
        const sender = yield* sessions.create({ title: "asker", permission: [...receiptsAllow] })
        const target = yield* sessions.create({ title: "busy body", permission: [...receiptsAllow] })
        yield* status.set(target.id, { type: "busy" })

        // The asker is parked in `ask` (its poll blocks without a loop of ours).
        const askFiber = yield* def
          .execute({ action: "ask", target: target.id, message: "STATUS_ASK_9", timeout: 60 }, toolCtx(sender.id))
          .pipe(Effect.forkChild)
        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const items = yield* coordination.inbox({ sessionID: target.id, kinds: ["request"], unreadOnly: true })
            return items.length === 1 ? items : undefined
          }),
          "the request never arrived",
          "10 seconds",
        )
        const requestID = pending[0]!.id
        yield* setCoordinationTimes(requestID, { timeCreated: Date.now() - 30_000 })

        // The responder child answers via the tool; scripted to only match its
        // own system prompt so no other session can consume the reply.
        yield* llm.pushMatch(
          (hit) => JSON.stringify(hit.body).includes("coordination responder for the PrioriCode session"),
          reply()
            .tool("sessions", { action: "respond", request_id: requestID, message: "part one is done" })
            .text("answered"),
        )
        expect(yield* watcher.sweep()).toBe(0)

        const out = yield* awaitWithTimeout(
          Fiber.join(askFiber),
          "the ask never received a delegated answer",
          "30 seconds",
        )
        expect(out.output).toContain(`Response from ${target.id} (request ${requestID}`)
        expect(out.output).toContain(`[answered by ${target.id}'s coordination responder`)
        expect(out.output).toContain("part one is done")

        // Ledger settled: the request is read AND acked.
        const row = yield* coordination.get(requestID)
        expect(row?.timeRead).toBeNumber()
        expect(row?.timeAck).toBeNumber()
        // The delegated response is attributed to the asked session, not the child.
        const responses = yield* coordination.responsesTo(requestID)
        expect(responses).toHaveLength(1)
        expect(responses[0]?.fromSession).toBe(target.id)

        // A record waits in the parent's inbox and lands in its next real turn.
        const records = yield* coordination.inbox({ sessionID: target.id, kinds: ["record"] })
        expect(records).toHaveLength(1)
        expect(records[0]?.body).toContain("STATUS_ASK_9")
        expect(records[0]?.body).toContain("part one is done")
        yield* status.set(target.id, { type: "idle" })
        yield* llm.text("noted, continuing")
        yield* user(target.id, "anything from peers?")
        yield* prompt.loop({ sessionID: target.id })
        const lastBody = JSON.stringify((yield* llm.hits).at(-1)?.body)
        expect(lastBody).toContain("handled for you while you were busy")
        expect(lastBody).toContain("STATUS_ASK_9")
      }),
    60_000,
  )

  coordinationIt.instance(
    "a stranger session cannot answer a request addressed to someone else",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const def = yield* Tool.init(yield* SessionsTool)
        const sender = yield* sessions.create({ title: "asker" })
        const target = yield* sessions.create({ title: "target" })
        const stranger = yield* sessions.create({ title: "nosey" })
        const request = yield* coordination.post({
          projectID: target.projectID,
          kind: "request",
          fromSession: sender.id,
          toSession: target.id,
          body: "status?",
        })
        const out = yield* def.execute(
          { action: "respond", request_id: request.id, message: "fake answer" },
          toolCtx(stranger.id),
        )
        expect(out.title).toBe("sessions:error")
        expect(out.output).toContain("is addressed to")
        expect(out.output).toContain("not to your session")
        expect(yield* coordination.responsesTo(request.id)).toHaveLength(0)
      }),
    15_000,
  )

  coordinationIt.instance(
    "delegated answers are single-shot but the owner may always correct",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const def = yield* Tool.init(yield* SessionsTool)
        const sender = yield* sessions.create({ title: "asker" })
        const target = yield* sessions.create({ title: "target", permission: [...receiptsAllow] })
        const responder = yield* sessions.create({
          parentID: target.id,
          agent: "responder",
          title: "responder child",
        })
        const request = yield* coordination.post({
          projectID: target.projectID,
          kind: "request",
          fromSession: sender.id,
          toSession: target.id,
          body: "are you editing x.ts?",
        })
        // The responder answers once, on the parent's behalf.
        const first = yield* def.execute(
          { action: "respond", request_id: request.id, message: "no, x.ts is free" },
          toolCtx(responder.id),
        )
        expect(first.title).toBe("sessions:respond")
        expect(yield* coordination.responsesTo(request.id)).toHaveLength(1)
        // A second delegated answer is refused (idempotency).
        const second = yield* def.execute(
          { action: "respond", request_id: request.id, message: "correction from responder" },
          toolCtx(responder.id),
        )
        expect(second.title).toBe("sessions:error")
        expect(second.output).toContain("already answered")
        // The main agent itself may correct after the fact.
        const third = yield* def.execute(
          { action: "respond", request_id: request.id, message: "update: actually I am on x.ts" },
          toolCtx(target.id),
        )
        expect(third.title).toBe("sessions:respond")
        expect(yield* coordination.responsesTo(request.id)).toHaveLength(2)
        // Exactly one record for the one delegation.
        const records = yield* coordination.inbox({ sessionID: target.id, kinds: ["record"] })
        expect(records).toHaveLength(1)
      }),
    15_000,
  )

  coordinationIt.instance(
    "a responder child is locked to action respond at the tool level",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const def = yield* Tool.init(yield* SessionsTool)
        const target = yield* sessions.create({ title: "target" })
        const responder = yield* sessions.create({
          parentID: target.id,
          agent: "responder",
          title: "responder child",
        })
        const out = yield* def.execute(
          { action: "send", target: target.id, message: "escalating beyond respond" },
          toolCtx(responder.id),
        )
        expect(out.title).toBe("sessions:error")
        expect(out.output).toContain('may only call action "respond"')
      }),
    15_000,
  )

  coordinationIt.instance(
    "ask timeout reports exactly how far delivery got",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const def = yield* Tool.init(yield* SessionsTool)
        const sender = yield* sessions.create({ title: "asker", permission: [...receiptsAllow] })
        const target = yield* sessions.create({ title: "stuck target" })
        const ask = yield* def
          .execute({ action: "ask", target: target.id, message: "WILL_TIMEOUT", timeout: 4 }, toolCtx(sender.id))
          .pipe(Effect.forkChild)
        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const items = yield* coordination.inbox({ sessionID: target.id, kinds: ["request"], unreadOnly: true })
            return items.length === 1 ? items : undefined
          }),
          "the request never arrived",
          "10 seconds",
        )
        // Simulate the target's context consuming the request cleanly mid-poll.
        yield* coordination.markRead([pending[0]!.id])
        yield* coordination.markAck([pending[0]!.id])
        const out = yield* awaitWithTimeout(Fiber.join(ask), "the ask never returned", "15 seconds")
        expect(out.output).toContain("no reply within 4s")
        expect(out.output).toContain("received and processed")
        expect(out.output).not.toContain("never saw it")
      }),
    30_000,
  )

  coordinationIt.instance(
    "discover exposes the sender-side receipt ledger through the lifecycle",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const coordination = yield* Coordination.Service
        const def = yield* Tool.init(yield* SessionsTool)
        const sender = yield* sessions.create({ title: "asker", permission: [...receiptsAllow] })
        const target = yield* sessions.create({ title: "target", permission: [...receiptsAllow] })
        yield* def.execute({ action: "send", target: target.id, message: "FYI_LEDGER" }, toolCtx(sender.id))
        let out = yield* def.execute({ action: "discover" }, toolCtx(sender.id))
        expect(out.output).toContain("queued — the peer has not seen it yet")

        yield* coordination.claimUnread(target.id, ["message"], { claimToken: "msg_peer" })
        out = yield* def.execute({ action: "discover" }, toolCtx(sender.id))
        expect(out.output).toContain("seen by the peer")
        expect(out.output).not.toContain("queued")

        const note = (yield* coordination.inbox({ sessionID: target.id, kinds: ["message"] }))[0]!
        yield* coordination.markAck([note.id])
        out = yield* def.execute({ action: "discover" }, toolCtx(sender.id))
        expect(out.output).toContain("received and processed by the peer")

        yield* coordination.post({
          projectID: sender.projectID,
          kind: "response",
          fromSession: target.id,
          toSession: sender.id,
          body: "irrelevant reply",
          replyTo: note.id,
        })
        out = yield* def.execute({ action: "discover" }, toolCtx(sender.id))
        expect(out.output).toContain("ANSWERED:")
      }),
    20_000,
  )
})
