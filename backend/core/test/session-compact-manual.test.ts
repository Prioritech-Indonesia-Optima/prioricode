import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@prioricode/llm"
import * as OpenAIChat from "@prioricode/llm/protocols/openai-chat"
import { AgentV2 } from "@prioricode/core/agent"
import { Config } from "@prioricode/core/config"
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
import { SessionEvent } from "@prioricode/core/session/event"
import { SessionMessage } from "@prioricode/core/session/message"
import { SkillGuidance } from "@prioricode/core/skill/guidance"
import { ReferenceGuidance } from "@prioricode/core/reference/guidance"
import { SystemContext } from "@prioricode/core/system-context"
import { Snapshot } from "@prioricode/core/snapshot"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { Cause, Effect, Deferred, Fiber, Layer, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { EventTable } from "@prioricode/core/event/sql"
import { testEffect } from "./lib/effect"

const directory = "/compact-manual"
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })

let responses: LLMEvent[][] = []
const requests: LLMRequest[] = []
let streamGate: Deferred.Deferred<void> | undefined
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      const events = Stream.fromIterable(responses.shift() ?? [])
      if (!streamGate) return events
      return Stream.unwrap(Deferred.await(streamGate).pipe(Effect.as(events)))
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

const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const location = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory: AbsolutePath.make(directory),
    workspaceID: undefined,
    project: { id: Project.ID.global, directory: AbsolutePath.make(directory) },
    vcs: undefined,
  }),
)

const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [Location.node, location],
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
      compact: (input) => sessionRunner.compact(input),
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
      [Location.node, location],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_compact_manual")
const otherID = SessionV2.ID.make("ses_compact_other")

const setup = Effect.gen(function* () {
  responses = []
  requests.length = 0
  streamGate = undefined
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  for (const id of [sessionID, otherID])
    yield* db
      .insert(SessionTable)
      .values({ id, project_id: Project.ID.global, slug: id, directory, title: "compact", version: "test" })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
})

const textTurn = (id: string, text: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]
const userTexts = (request: LLMRequest) =>
  request.messages.flatMap((message) =>
    message.role === "user"
      ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : []))
      : [],
  )

describe("manual compaction", () => {
  it.live("anchored compaction summarizes the head, keeps the tail verbatim, and re-baselines", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "First question alpha" }), resume: false })
      responses = [textTurn("text-one", "answer one")]
      yield* session.resume(sessionID)
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Second question beta" }), resume: false })
      responses = [textTurn("text-two", "answer two")]
      yield* session.resume(sessionID)

      const before = yield* session.context(sessionID)
      const anchor = before.find((message) => message.type === "assistant" && message.finish === "stop")
      expect(anchor).toBeDefined()

      requests.length = 0
      responses = [textTurn("text-summary", "SUMMARY-CHECKPOINT")]
      const compacted = yield* session.compact({
        sessionID,
        anchor: anchor!.id,
        instructions: "keep the alpha decision",
      })
      expect(compacted).toBe(true)
      expect(requests).toHaveLength(1)
      const summaryRequest = userTexts(requests[0]!).join("\n")
      expect(summaryRequest).toContain("keep the alpha decision")
      expect(summaryRequest).toContain("First question alpha")
      expect(summaryRequest).not.toContain("Second question beta")

      const after = yield* session.context(sessionID)
      expect(after[0]).toMatchObject({ type: "compaction", summary: "SUMMARY-CHECKPOINT" })

      requests.length = 0
      responses = [textTurn("text-three", "answer three")]
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Third question gamma" }), resume: false })
      yield* session.resume(sessionID)
      const next = userTexts(requests[0]!).join("\n")
      expect(next).toContain("<summary>")
      expect(next).toContain("SUMMARY-CHECKPOINT")
      expect(next).toContain("Second question beta")
      expect(next).not.toContain("First question alpha")
      expect(requests).toHaveLength(1)
    }),
  )

  it.live("compaction without an anchor summarizes all but the final message", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Old context" }), resume: false })
      responses = [textTurn("text-old", "old answer")]
      yield* session.resume(sessionID)
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Latest context" }), resume: false })
      responses = [textTurn("text-latest", "latest answer")]
      yield* session.resume(sessionID)

      requests.length = 0
      responses = [textTurn("text-summary", "FULL-SUMMARY")]
      expect(yield* session.compact({ sessionID })).toBe(true)
      const summaryRequest = userTexts(requests[0]!).join("\n")
      expect(summaryRequest).toContain("Old context")
      expect(summaryRequest).not.toContain("Latest context")
      const after = yield* session.context(sessionID)
      expect(after[0]).toMatchObject({ type: "compaction", summary: "FULL-SUMMARY" })
    }),
  )

  it.live("records an explainable manual decision and outcome on the compaction events", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "First question alpha" }), resume: false })
      responses = [textTurn("text-one", "answer one")]
      yield* session.resume(sessionID)
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Second question beta" }), resume: false })
      responses = [textTurn("text-two", "answer two")]
      yield* session.resume(sessionID)

      responses = [textTurn("text-summary", "SUMMARY-CHECKPOINT")]
      expect(yield* session.compact({ sessionID })).toBe(true)

      const rows = yield* db
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      const started = rows.find((row) => row.type === EventV2.versionedType(SessionEvent.Compaction.Started.type, 1))
      const ended = rows.find((row) => row.type === EventV2.versionedType(SessionEvent.Compaction.Ended.type, 1))
      expect(started).toBeDefined()
      expect(ended).toBeDefined()
      expect((started!.data as Record<string, unknown>).decision).toMatchObject({
        trigger: "manual",
        context_source: "default",
        fallback: "none",
      })
      expect((ended!.data as Record<string, unknown>).outcome).toBe("summarized")
    }),
  )

  it.live("a busy session refuses manual compaction with BusyError", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Hold the gate" }), resume: false })
      streamGate = yield* Deferred.make<void>()
      responses = [textTurn("text-gated", "gated answer")]
      const drain = yield* session.resume(sessionID).pipe(Effect.forkChild)
      let active = yield* session.active
      while (!active.has(sessionID)) {
        yield* Effect.yieldNow
        active = yield* session.active
      }
      const exit = yield* session.compact({ sessionID }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.squash(exit.cause)).toBeInstanceOf(SessionV2.BusyError)
      yield* Deferred.succeed(streamGate, undefined)
      yield* Effect.ignore(Fiber.join(drain))
    }),
  )

  it.effect("unknown or foreign anchors are rejected; empty history is a no-op", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const missing = yield* Effect.exit(
        session.compact({ sessionID, anchor: SessionMessage.ID.make("msg_nonexistent") }),
      )
      expect(missing._tag).toBe("Failure")

      yield* session.prompt({ sessionID: otherID, prompt: Prompt.make({ text: "Foreign" }), resume: false })
      responses = [textTurn("text-foreign", "foreign answer")]
      yield* session.resume(otherID)
      const foreign = (yield* session.context(otherID))[0]
      const cross = yield* Effect.exit(session.compact({ sessionID, anchor: foreign.id }))
      expect(cross._tag).toBe("Failure")

      requests.length = 0
      expect(yield* session.compact({ sessionID })).toBe(false)
      expect(requests).toHaveLength(0)
    }),
  )
})
