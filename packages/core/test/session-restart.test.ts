import { describe, expect } from "bun:test"
import path from "path"
import { Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { LLMClient, LLMEvent, type LLMClientShape } from "@prioricode/llm"
import * as OpenAIChat from "@prioricode/llm/protocols/openai-chat"
import { Model } from "@prioricode/llm"
import { AgentV2 } from "@prioricode/core/agent"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@prioricode/core/effect/app-node-platform"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Config } from "@prioricode/core/config"
import { Database } from "@prioricode/core/database/database"
import { EventV2 } from "@prioricode/core/event"
import { AbsolutePath } from "@prioricode/core/schema"
import { Location } from "@prioricode/core/location"
import { PermissionV2 } from "@prioricode/core/permission"
import { ProjectV2 } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { SessionV2 } from "@prioricode/core/session"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionProjector } from "@prioricode/core/session/projector"
import { SessionRunner } from "@prioricode/core/session/runner"
import * as SessionRunnerLLM from "@prioricode/core/session/runner/llm"
import { SessionRunnerModel } from "@prioricode/core/session/runner/model"
import { SessionStore } from "@prioricode/core/session/store"
import { SkillGuidance } from "@prioricode/core/skill/guidance"
import { ReferenceGuidance } from "@prioricode/core/reference/guidance"
import { Snapshot } from "@prioricode/core/snapshot"
import { SystemContext } from "@prioricode/core/system-context"
import { SystemContextRegistry } from "@prioricode/core/system-context/registry"
import { Tool } from "@prioricode/core/tool/tool"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const directory = AbsolutePath.make("/restart-test")
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const agent: AgentV2.Info = {
  id: AgentV2.ID.make("build"),
  mode: "primary",
  hidden: false,
  permissions: [],
  request: { headers: {}, body: {} },
}

const toolStarted = Deferred.makeUnsafe<void>()
const toolGate = Deferred.makeUnsafe<void>()
let turns: LLMEvent[][] = []
let providerTurns = 0

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: (() => {
      const events = turns[providerTurns++] ?? []
      return Stream.fromIterable(events)
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)

const tools = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      echo: Tool.make({
        description: "Echo after a gate",
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.Struct({ text: Schema.String }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: ({ text }) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(toolStarted, undefined)
            yield* Deferred.await(toolGate)
            return { text }
          }),
      }),
    }),
  ),
)
const toolsNode = LayerNode.make({ name: "test/restart-tools", layer: tools, deps: [ToolRegistry.node] })

const appLayer = (file: string) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      toolsNode,
      AgentV2.node,
      Config.node,
      ProjectV2.node,
      Snapshot.node,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      PermissionV2.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      [Database.node, Database.layerFromPath(file)],
      [LayerNodePlatform.llmClient, client],
      [SessionRunnerModel.node, SessionRunnerModel.layerWith(() => Effect.succeed(model))],
      [
        PermissionV2.node,
        Layer.succeed(
          PermissionV2.Service,
          PermissionV2.Service.of({
            assert: () => Effect.void,
            ask: () => Effect.die("unused"),
            reply: () => Effect.die("unused"),
            get: () => Effect.die("unused"),
            forSession: () => Effect.die("unused"),
            list: () => Effect.die("unused"),
          }),
        ),
      ],
      [
        AgentV2.node,
        Layer.succeed(
          AgentV2.Service,
          AgentV2.Service.of({
            transform: () => Effect.succeed({ dispose: Effect.void, remove: () => Effect.void }),
            reload: () => Effect.void,
            get: (id: AgentV2.ID) => Effect.succeed(id === agent.id ? agent : undefined),
            default: () => Effect.succeed(agent),
            resolve: () => Effect.succeed(agent),
            select: () => Effect.succeed({ id: agent.id, info: agent }),
            all: () => Effect.succeed([agent]),
          }),
        ),
      ],
      [
        Config.node,
        Layer.succeed(
          Config.Service,
          Config.Service.of({ entries: () => Effect.succeed([]) }),
        ),
      ],
      [
        ProjectV2.node,
        Layer.succeed(
          ProjectV2.Service,
          ProjectV2.Service.of({
            resolve: (value: AbsolutePath) => Effect.succeed({ id: ProjectV2.ID.global, directory: value }),
            directories: () => Effect.succeed([]),
            commit: () => Effect.void,
          }),
        ),
      ],
      [Snapshot.node, Snapshot.noopLayer],
      [Location.node, Layer.succeed(Location.Service, Location.Service.of(location({ directory })))],
      [
        SystemContextRegistry.node,
        Layer.succeed(
          SystemContextRegistry.Service,
          SystemContextRegistry.Service.of({
            register: () => Effect.void,
            load: () => Effect.succeed(SystemContext.empty),
          }),
        ),
      ],
      [
        SkillGuidance.node,
        Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) }),
      ],
      [
        ReferenceGuidance.node,
        Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) }),
      ],
      [
        SessionExecution.node,
        Layer.succeed(
          SessionExecution.Service,
          SessionExecution.Service.of({
            active: Effect.succeed(new Set<SessionV2.ID>()),
            resume: () => Effect.void,
            wake: () => Effect.void,
            interrupt: () => Effect.void,
          }),
        ),
      ],
    ],
  )

const crashTurn = [
  LLMEvent.toolInputStart({ id: "call-crash", name: "echo" }),
  LLMEvent.toolInputDelta({ id: "call-crash", name: "echo", text: JSON.stringify({ text: "never returns" }) }),
  LLMEvent.toolInputEnd({ id: "call-crash", name: "echo" }),
  LLMEvent.toolCall({ id: "call-crash", name: "echo", input: { text: "never returns" } }),
  LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
  LLMEvent.finish({ reason: "tool-calls" }),
]

const recoveryTurn = [
  LLMEvent.textStart({ id: "text-recovered" }),
  LLMEvent.textDelta({ id: "text-recovered", text: "Recovered after process loss" }),
  LLMEvent.textEnd({ id: "text-recovered" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const it = testEffect(Layer.empty)

const lifetime1 = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: ProjectV2.ID.global, worktree: directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const sessions = yield* SessionV2.Service
  const runner = yield* SessionRunner.Service
  const created = yield* sessions.create({ location: { directory } })
  yield* sessions.prompt({ sessionID: created.id, prompt: { text: "Echo then report" }, delivery: "queue", resume: false })
  turns = [crashTurn]
  providerTurns = 0
  const drain = yield* runner.run({ sessionID: created.id, force: true }).pipe(Effect.forkScoped)
  yield* Deferred.await(toolStarted)
  yield* Fiber.interrupt(drain)
  return created.id
})

const lifetime2 = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const runner = yield* SessionRunner.Service
    turns = [recoveryTurn]
    providerTurns = 0
    yield* runner.run({ sessionID, force: true })
    const context = yield* sessions.context(sessionID)
    const interrupted = context.find(
      (message) =>
        message.type === "assistant" &&
        message.content.some(
          (content) =>
            content.type === "tool" &&
            content.id === "call-crash" &&
            content.state.status === "error" &&
            content.state.error.message.includes("interrupted"),
        ),
    )
    expect(interrupted === undefined).toBe(false)
    const settled = context.findLast(
      (message) =>
        message.type === "assistant" &&
        message.finish === "stop" &&
        message.content.some((content) => content.type === "text" && content.text.includes("Recovered")),
    )
    expect(settled === undefined).toBe(false)
  })

describe("SessionV2 continuation across process loss", () => {
  it.effect("an unsettled tool from a lost drain settles on the next drain and the Session completes", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
      )
      const file = path.join(tmp.path, "restart.sqlite")
      const sessionID = yield* Effect.scoped(Effect.provide(lifetime1, appLayer(file)))
      yield* Effect.scoped(Effect.provide(lifetime2(sessionID), appLayer(file)))
    }),
  )
})
