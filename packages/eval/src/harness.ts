/**
 * Offline evaluation harness: drives the real V2 durable runner (event log,
 * projector, input admission, tool registry, loop guards, verification pass)
 * against scripted provider turns. No network, no API keys — deterministic by
 * construction, so loop, tool, and prompt changes are gated on regressions.
 */
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { LLMClient, LLMEvent, type LLMClientShape } from "@prioricode/llm"
import * as OpenAIChat from "@prioricode/llm/protocols/openai-chat"
import { Model } from "@prioricode/llm"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@prioricode/core/effect/app-node-platform"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Database } from "@prioricode/core/database/database"
import { EventV2 } from "@prioricode/core/event"
import { PermissionV2 } from "@prioricode/core/permission"
import { ProjectV2 } from "@prioricode/core/project"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionV2 } from "@prioricode/core/session"
import { SessionSchema } from "@prioricode/core/session/schema"
import { Prompt } from "@prioricode/core/session/prompt"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionRunCoordinator } from "@prioricode/core/session/run-coordinator"
import { SessionProjector } from "@prioricode/core/session/projector"
import { SessionStore } from "@prioricode/core/session/store"
import { SessionRunner } from "@prioricode/core/session/runner"
import * as SessionRunnerLLM from "@prioricode/core/session/runner/llm"
import { SessionRunnerModel } from "@prioricode/core/session/runner/model"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { Tool } from "@prioricode/core/tool/tool"
import { Config } from "@prioricode/core/config"
import { ConfigCompaction } from "@prioricode/core/config/compaction"
import { ConfigLoop } from "@prioricode/core/config/loop"
import { ConfigVerify } from "@prioricode/core/config/verify"
import { AgentV2 } from "@prioricode/core/agent"
import { Location } from "@prioricode/core/location"
import { Snapshot } from "@prioricode/core/snapshot"
import { SystemContext } from "@prioricode/core/system-context"
import { SystemContextRegistry } from "@prioricode/core/system-context/registry"
import { SkillGuidance } from "@prioricode/core/skill/guidance"
import { ReferenceGuidance } from "@prioricode/core/reference/guidance"

export { LLMEvent, Effect, Layer, SessionV2, type Prompt }

export const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })

export const finishStop: LLMEvent[] = [
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

export const textTurn = (id: string, text: string): LLMEvent[] => [
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  ...finishStop,
]

export const toolTurn = (...calls: Array<{ id: string; name: string; input: unknown }>): LLMEvent[] => [
  ...calls.flatMap((call) => [
    LLMEvent.toolInputStart({ id: call.id, name: call.name }),
    LLMEvent.toolInputDelta({ id: call.id, name: call.name, text: JSON.stringify(call.input) }),
    LLMEvent.toolInputEnd({ id: call.id, name: call.name }),
    LLMEvent.toolCall({ id: call.id, name: call.name, input: call.input }),
  ]),
  LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
  LLMEvent.finish({ reason: "tool-calls" }),
]

export type Harness = {
  readonly requests: number
  readonly captured: () => unknown[]
  readonly writes: string[]
  readonly turns: (turns: LLMEvent[][]) => void
  readonly failNext: (error: unknown) => void
}

export type ScenarioConfig = {
  readonly directory: string
  readonly loop?: ConfigLoop.Info
  readonly verify?: ConfigVerify.Info
}

const agent: AgentV2.Info = {
  id: AgentV2.ID.make("build"),
  mode: "primary",
  hidden: false,
  permissions: [],
  request: { headers: {}, body: {} },
}

export const provideHarness = <A, E, R>(
  config: ScenarioConfig,
  use: (harness: Harness, sessions: SessionV2.Interface, sessionID: SessionSchema.ID) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      let requestCount = 0
      const captured: unknown[] = []
      const writes: string[] = []
      let pending: LLMEvent[][] = []
      let failures: unknown[] = []
      const harness: Harness = {
        get requests() {
          return requestCount
        },
        captured: () => captured,
        writes,
        turns: (turns) => {
          pending = turns
        },
        failNext: (error) => {
          failures.push(error)
        },
      }

      const client = Layer.succeed(
        LLMClient.Service,
        LLMClient.Service.of({
          prepare: () => Effect.die("unused"),
          stream: ((request: unknown) => {
            requestCount++
            captured.push(request)
            const failure = failures.shift()
            if (failure !== undefined) return Stream.fail(failure as never)
            const events = pending.shift() ?? finishStop
            return Stream.fromIterable(events)
          }) as unknown as LLMClientShape["stream"],
          generate: () => Effect.die("unused"),
        }),
      )
      const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
      const configLayer = Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () =>
            Effect.succeed([
              new Config.Document({
                type: "document",
                info: new Config.Info({
                  compaction: new ConfigCompaction.Info({
                    buffer: 3_000,
                    keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
                  }),
                  ...(config.loop === undefined ? {} : { loop: config.loop }),
                  ...(config.verify === undefined ? {} : { verify: config.verify }),
                }),
              }),
            ]),
        }),
      )
      const permission = Layer.succeed(
        PermissionV2.Service,
        PermissionV2.Service.of({
          assert: () => Effect.void,
          ask: () => Effect.die("unused"),
          reply: () => Effect.die("unused"),
          get: () => Effect.die("unused"),
          forSession: () => Effect.die("unused"),
          list: () => Effect.die("unused"),
        }),
      )
      const agents = Layer.succeed(
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
      )
      const tools = Layer.effectDiscard(
        ToolRegistry.Service.use((registry) =>
          registry.register({
            echo: Tool.make({
              description: "Echo text",
              input: Schema.Struct({ text: Schema.String }),
              output: Schema.Struct({ text: Schema.String }),
              toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
              execute: ({ text }) => Effect.succeed({ text }),
            }),
            write: Tool.make({
              description: "Record a workspace mutation",
              input: Schema.Struct({ path: Schema.String }),
              output: Schema.Struct({ path: Schema.String }),
              toModelOutput: ({ output }) => [{ type: "text", text: `wrote ${output.path}` }],
              execute: ({ path }) => Effect.sync(() => (writes.push(path), { path })),
            }),
          }),
        ),
      )
      const toolsNode = LayerNode.make({ name: "eval/tools", layer: tools, deps: [ToolRegistry.node] })
      const location = Location.boundNode({ directory: AbsolutePath.make(config.directory) })
      const overrides: LayerNode.Replacements = [
        [LayerNodePlatform.llmClient, client],
        [SessionRunnerModel.node, models],
        [PermissionV2.node, permission],
        [AgentV2.node, agents],
        [Config.node, configLayer],
        [Snapshot.node, Snapshot.noopLayer],
        [Location.node, location],
        [
          SkillGuidance.node,
          Layer.mock(SkillGuidance.Service as never, { load: () => Effect.succeed(SystemContext.empty) } as never),
        ],
        [
          ReferenceGuidance.node,
          Layer.mock(ReferenceGuidance.Service as never, { load: () => Effect.succeed(SystemContext.empty) } as never),
        ],
      ] as unknown as LayerNode.Replacements
      const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, overrides)
      const execution = Layer.effect(
        SessionExecution.Service,
        Effect.gen(function* () {
          const sessionRunner = yield* SessionRunner.Service
          const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
            drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
          })
          return SessionExecution.Service.of({
            active: coordinator.active,
            resume: coordinator.run,
            wake: coordinator.wake,
            interrupt: coordinator.interrupt,
          })
        }),
      ).pipe(Layer.provide(runnerLayer))
      const appLayer = AppNodeBuilder.build(
        LayerNode.group([
          Database.node,
          EventV2.node,
          SessionProjector.node,
          SessionStore.node,
          ToolRegistry.node,
          ToolRegistry.toolsNode,
          toolsNode,
          SessionRunnerModel.node,
          SystemContextRegistry.node,
          SkillGuidance.node,
          ReferenceGuidance.node,
          Config.node,
          Snapshot.node,
          AgentV2.node,
          PermissionV2.node,
          SessionRunnerLLM.node,
          SessionExecution.node,
          SessionV2.node,
        ]),
        [...overrides, [SessionExecution.node, execution]],
      )
      const program = Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const created = yield* sessions.create({
          location: { directory: AbsolutePath.make(config.directory) },
        })
        return yield* use(harness, sessions, created.id)
      })
      return yield* program.pipe(Effect.provide(Layer.fresh(appLayer)))
    }),
  )

export type SessionID = typeof SessionSchema.ID.Type
