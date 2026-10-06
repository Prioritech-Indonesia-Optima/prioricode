import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@prioricode/llm"
import * as OpenAIChat from "@prioricode/llm/protocols/openai-chat"
import { AgentV2 } from "@prioricode/core/agent"
import { Config } from "@prioricode/core/config"
import { ConfigCompaction } from "@prioricode/core/config/compaction"
import { ConfigPrune } from "@prioricode/core/config/prune"
import { ConfigToolOutput } from "@prioricode/core/config/tool-output"
import { Database } from "@prioricode/core/database/database"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@prioricode/core/effect/app-node-platform"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { EventV2 } from "@prioricode/core/event"
import { Location } from "@prioricode/core/location"
import { PermissionV2 } from "@prioricode/core/permission"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionV2 } from "@prioricode/core/session"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionRunCoordinator } from "@prioricode/core/session/run-coordinator"
import { SessionRunner } from "@prioricode/core/session/runner"
import * as SessionRunnerLLM from "@prioricode/core/session/runner/llm"
import { SessionRunnerModel } from "@prioricode/core/session/runner/model"
import { SessionProjector } from "@prioricode/core/session/projector"
import { SessionStore } from "@prioricode/core/session/store"
import { SessionTable } from "@prioricode/core/session/sql"
import { Prompt } from "@prioricode/core/session/prompt"
import { SkillGuidance } from "@prioricode/core/skill/guidance"
import { ReferenceGuidance } from "@prioricode/core/reference/guidance"
import { SystemContext } from "@prioricode/core/system-context"
import { Snapshot } from "@prioricode/core/snapshot"
import { Tool } from "@prioricode/core/tool/tool"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { makeLocationNode } from "@prioricode/core/effect/app-node"
import { Schema, Effect, Layer, Stream } from "effect"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const directory = "/budget-project"
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })

let responses: LLMEvent[][] = []
const requests: LLMRequest[] = []
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(responses.shift() ?? [])
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
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

const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({ auto: false }),
            tool_output: new ConfigToolOutput.Info({ max_bytes: 2_000_000 }),
            prune: new ConfigPrune.Info({ keep_recent_steps: 1 }),
          }),
        }),
      ]),
  }),
)
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory: AbsolutePath.make(directory),
    workspaceID: undefined,
    project: { id: Project.ID.global, directory: AbsolutePath.make(directory) },
    vcs: undefined,
  }),
)

// A deterministic oversized local tool result used to cross the pruning
// pressure line (>=70% of the default 128k window is roughly 358k characters).
const huge = "PRUNED-MARK-".repeat(30_000)
const spit = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      spit: Tool.make({
        description: "Emit deterministic large output",
        input: Schema.Struct({}),
        output: Schema.Struct({ text: Schema.String }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: () => Effect.succeed({ text: huge }),
      }),
    }),
  ),
)
const spitNode = makeLocationNode({ name: "test/budget-tools", layer: spit, deps: [ToolRegistry.node] })

const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [Location.node, locationLayer],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [PermissionV2.node, permission],
  [Config.node, config],
])
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
      compact: () => Effect.succeed(false),
    })
  }),
).pipe(Layer.provide(runnerLayer))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      spitNode,
      SessionRunnerModel.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [SessionRunnerModel.node, models],
      [Location.node, locationLayer],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_budget_test")

const setup = Effect.gen(function* () {
  responses = []
  requests.length = 0
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: sessionID,
      directory,
      title: "budget",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const systemJoin = (request: LLMRequest) =>
  ((request as unknown as { readonly system?: ReadonlyArray<{ readonly text?: string }> }).system ?? [])
    .map((part) => part.text ?? "")
    .join("\n")
const turn = (events: LLMEvent[]) => [
  LLMEvent.stepStart({ index: 0 }),
  ...events,
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

describe("context economics in a live drain", () => {
  it.live("the baseline starts low and a tier crossing arrives chronologically", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "One" }), resume: false })
      responses = [turn([])]
      yield* session.resume(sessionID)
      expect(systemJoin(requests[0]!)).not.toContain("Context usage tier")

      yield* db
        .update(SessionTable)
        .set({ tokens_input: 100_000 })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Two" }), resume: false })
      responses = [turn([])]
      yield* session.resume(sessionID)
      const second = JSON.stringify(requests[1]!.messages)
      expect(second).toContain("Context usage tier: critical")
      // the immutable baseline of the epoch never changes mid-epoch
      expect(systemJoin(requests[1]!)).not.toContain("Context usage tier")
    }),
  )

  it.live("a completed step advances the session-row usage so the budget tier reflects real tokens", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Bill this" }), resume: false })
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-billed" }),
          LLMEvent.textDelta({ id: "text-billed", text: "Done" }),
          LLMEvent.textEnd({ id: "text-billed" }),
          LLMEvent.stepFinish({
            index: 0,
            reason: "stop",
            usage: {
              inputTokens: 4_000,
              nonCachedInputTokens: 4_000,
              outputTokens: 100,
              reasoningTokens: 0,
              cacheReadInputTokens: 0,
            },
          }),
          LLMEvent.finish({ reason: "stop" }),
        ],
      ]
      yield* session.resume(sessionID)

      const row = yield* db
        .select({ tokensInput: SessionTable.tokens_input, tokensOutput: SessionTable.tokens_output })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      expect(row?.tokensInput).toBe(4_000)
      expect(row?.tokensOutput).toBe(100)
    }),
  )

  it.live("pressure elides older large tool output in requests while history stays whole", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Spit three times" }), resume: false })
      responses = [
        turn([LLMEvent.toolCall({ id: "call-spit-1", name: "spit", input: {} })]),
        turn([LLMEvent.toolCall({ id: "call-spit-2", name: "spit", input: {} })]),
        turn([LLMEvent.toolCall({ id: "call-spit-3", name: "spit", input: {} })]),
        turn([]),
      ]
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(4)
      // turn 2: the single settled result is inside the protected recent step
      const second = JSON.stringify(requests[1]!.messages)
      expect(second).toContain("PRUNED-MARK-")
      expect(second).not.toContain("tool output pruned")
      // final turn: pressure elides the two older results, keeps the newest
      const last = JSON.stringify(requests[3]!.messages)
      expect(last).toContain("tool output pruned —")
      expect(last).toContain("PRUNED-MARK-")
      // durable history keeps every full payload
      const durable = yield* session.context(sessionID)
      const durableText = JSON.stringify(durable)
      expect(durableText.match(/PRUNED-MARK-/g)!.length).toBeGreaterThanOrEqual(3 * 30_000)
    }),
  )
})
