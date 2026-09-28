import { describe, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  LLMClient,
  LLMEvent,
  Model,
  type LLMClientShape,
  type LLMRequest,
} from "@prioricode/llm"
import * as OpenAIChat from "@prioricode/llm/protocols/openai-chat"
import { Config } from "@prioricode/core/config"
import { ConfigHooks } from "@prioricode/core/config/hooks"
import { Database } from "@prioricode/core/database/database"
import { makeLocationNode } from "@prioricode/core/effect/app-node"
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
import { Prompt } from "@prioricode/core/session/prompt"
import { SessionProjector } from "@prioricode/core/session/projector"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionRunCoordinator } from "@prioricode/core/session/run-coordinator"
import { SessionRunner } from "@prioricode/core/session/runner"
import * as SessionRunnerLLM from "@prioricode/core/session/runner/llm"
import { SessionRunnerModel } from "@prioricode/core/session/runner/model"
import { EventTable } from "@prioricode/core/event/sql"
import { SessionTable } from "@prioricode/core/session/sql"
import { SessionStore } from "@prioricode/core/session/store"
import { AgentV2 } from "@prioricode/core/agent"
import { SkillGuidance } from "@prioricode/core/skill/guidance"
import { ReferenceGuidance } from "@prioricode/core/reference/guidance"
import { SystemContext } from "@prioricode/core/system-context"
import { SystemContextRegistry } from "@prioricode/core/system-context/registry"
import { Snapshot } from "@prioricode/core/snapshot"
import { Tool } from "@prioricode/core/tool/tool"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { ApplicationTools } from "@prioricode/core/tool/application-tools"
import { Effect, Layer, Schema, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "prioricode-hook-wiring-"))
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })

let responses: LLMEvent[][] = []
const requests: LLMRequest[] = []
const executions: string[] = []
const permissionAsserts: PermissionV2.AssertInput[] = []
let permissionDeny = false

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

const hookAsserts = (input: PermissionV2.AssertInput) =>
  Effect.gen(function* () {
    permissionAsserts.push(input)
    if (input.action !== "hooks.project") return yield* Effect.die(`unexpected permission action: ${input.action}`)
    if (permissionDeny) return yield* Effect.fail(new PermissionV2.DeclinedError({}))
  })

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: hookAsserts as unknown as PermissionV2.Interface["assert"],
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const echo = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      echo: Tool.make({
        description: "Echo text",
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.Struct({ text: Schema.String }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: ({ text }) =>
          Effect.sync(() => {
            executions.push(text)
            return { text }
          }),
      }),
    }),
  ),
)
const echoNode = makeLocationNode({ name: "test/hook-wiring-tools", layer: echo, deps: [ToolRegistry.node] })

let hookDocuments: ConfigHooks.Info[] = []
let hookProjectFrom = Number.MAX_SAFE_INTEGER
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.suspend(() =>
        Effect.succeed(
          hookDocuments.map(
            (hooks, index) =>
              new Config.Document({
                type: "document",
                path: index >= hookProjectFrom ? path.join(directory, ".prioricode", "prioricode.json") : undefined,
                info: new Config.Info({ hooks }),
              }),
          ),
        ),
      ),
  }),
)

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
    })
  }),
).pipe(Layer.provide(runnerLayer))
const graph = AppNodeBuilder.build(
  LayerNode.group([
    Database.node,
    EventV2.node,
    SessionProjector.node,
    SessionStore.node,
    ApplicationTools.node,
    AgentV2.node,
    ToolRegistry.node,
    ToolRegistry.toolsNode,
    echoNode,
    SessionRunnerModel.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    Config.node,
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
)

const it = testEffect(graph)
const sessionID = SessionV2.ID.make("ses_hook_wiring_test")

const setup = (documents: ConfigHooks.Info[], projectFrom = Number.MAX_SAFE_INTEGER) =>
  Effect.gen(function* () {
    hookDocuments = documents
    hookProjectFrom = projectFrom
    responses = []
    requests.length = 0
    executions.length = 0
    permissionAsserts.length = 0
    permissionDeny = false
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
        title: "hook wiring",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const toolCallEvents = (id: string, text: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.toolCall({ id, name: "echo", input: { text } }),
  LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
  LLMEvent.finish({ reason: "tool-calls" }),
]
const finalTextEvents = (id: string, text: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]
const toolPartJSON = (session: SessionV2.Interface, callID: string) =>
  Effect.map(session.context(sessionID), (messages) =>
    messages
      .flatMap((message) =>
        message.type === "assistant"
          ? message.content.filter((part) => part.type === "tool" && part.id === callID)
          : [],
      )
      .map((part) => JSON.stringify(part))
      .join("\n"),
  )
const durableEvents = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return yield* db
    .select()
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, sessionID))
    .orderBy(asc(EventTable.seq))
    .all()
    .pipe(Effect.orDie)
})
const userTexts = (session: SessionV2.Interface) =>
  Effect.map(session.context(sessionID), (messages) =>
    messages.flatMap((message) => (message.type === "user" ? [message.text] : [])),
  )

const posixOnly = process.platform === "win32" ? describe.skip : describe
const sh = (script: string) => new ConfigHooks.HookCommand({ command: script })
const bun = (script: string) => new ConfigHooks.HookCommand({ command: [process.execPath, "-e", script] })
const info = (input: Partial<ConstructorParameters<typeof ConfigHooks.Info>[0]>) => new ConfigHooks.Info(input)

posixOnly("hook wiring", () => {
  it.live("PreToolUse exit 2 replaces the tool result and the tool never executes", () =>
    Effect.gen(function* () {
      yield* setup([info({ PreToolUse: [sh("printf 'no echoing allowed\\n' >&2; exit 2")] })])
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Echo this" }), resume: false })
      responses = [toolCallEvents("call-blocked", "hello"), finalTextEvents("text-end", "Understood")]
      yield* session.resume(sessionID)
      expect(executions).toEqual([])
      expect(yield* toolPartJSON(session, "call-blocked")).toContain("no echoing allowed")
      expect(requests).toHaveLength(2)
    }),
  )

  it.live("matcher mismatch lets the tool run", () =>
    Effect.gen(function* () {
      yield* setup([info({ PreToolUse: [new ConfigHooks.HookCommand({ matcher: "edit*", command: "printf 'no echoing allowed\\n' >&2; exit 2" })] })])
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Echo this" }), resume: false })
      responses = [toolCallEvents("call-run", "hello"), []]
      yield* session.resume(sessionID)
      expect(executions).toEqual(["hello"])
    }),
  )

  it.live("PostToolUse stdout is appended to the settled tool result", () =>
    Effect.gen(function* () {
      yield* setup([info({ PostToolUse: [sh("printf 'lint: 1 warning'")] })])
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Echo this" }), resume: false })
      responses = [toolCallEvents("call-note", "hello"), []]
      yield* session.resume(sessionID)
      expect(executions).toEqual(["hello"])
      const followUp = yield* toolPartJSON(session, "call-note")
      expect(followUp).toContain("hello")
      expect(followUp).toContain("Output from configured PostToolUse hooks (untrusted")
      expect(followUp).toContain("lint: 1 warning")
    }),
  )

  it.live("Stop exit 2 continues the drain once with the hook reason as a steer prompt", () =>
    Effect.gen(function* () {
      yield* setup([
        info({
          Stop: [
            sh(
              "if [ -e stop.done ]; then exit 0; fi; touch stop.done; printf 'run the tests first\\n' >&2; exit 2",
            ),
          ],
        }),
      ])
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Done?" }), resume: false })
      responses = [
        finalTextEvents("text-stop", "All done"),
        finalTextEvents("text-stop-2", "Tests pass now"),
      ]
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(2)
      const texts = yield* userTexts(session)
      expect(texts.some((text) => text.includes("run the tests first") && text.includes("Stop hook"))).toBe(true)
    }),
  )

  it.live("Stop allow without hooks costs nothing and the drain finishes", () =>
    Effect.gen(function* () {
      yield* setup([info({})])
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Hello" }), resume: false })
      responses = [finalTextEvents("text-only", "Hi")]
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(1)
      expect(permissionAsserts).toEqual([])
    }),
  )

  it.live("SessionStart fires on the first provider turn only", () =>
    Effect.gen(function* () {
      fs.rmSync(path.join(directory, "start.marker"), { force: true })
      yield* setup([
        info({
          SessionStart: [
            bun(
              'let d="";process.stdin.on("data",(c)=>(d+=c)).on("end",()=>{const j=JSON.parse(d);if(j.hook_event_name==="SessionStart"&&j.source==="new")require("fs").appendFileSync(j.cwd+"/start.marker",j.session_id+"\\n")})',
            ),
          ],
        }),
      ])
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "First" }), resume: false })
      responses = [finalTextEvents("text-a", "A")]
      yield* session.resume(sessionID)
      expect(fs.readFileSync(path.join(directory, "start.marker"), "utf8")).toBe(sessionID + "\n")
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Second" }), resume: false })
      responses = [finalTextEvents("text-b", "B")]
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(2)
      expect(fs.readFileSync(path.join(directory, "start.marker"), "utf8")).toBe(sessionID + "\n")
    }),
  )

  it.live("project hooks run once approved and the saved resource keys the hash", () =>
    Effect.gen(function* () {
      yield* setup(
        [info({ PreToolUse: [sh("exit 0")] }), info({ PreToolUse: [sh("printf 'project policy\\n' >&2; exit 2")] })],
        1,
      )
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Echo this" }), resume: false })
      responses = [toolCallEvents("call-project", "hello"), []]
      yield* session.resume(sessionID)
      expect(permissionAsserts.map((input) => input.action)).toEqual(["hooks.project"])
      expect(permissionAsserts[0]?.resources).toEqual(permissionAsserts[0]?.save ?? [])
      expect(executions).toEqual([])
      expect(yield* toolPartJSON(session, "call-project")).toContain("project policy")
    }),
  )

  it.live("denied project trust leaves project hooks inert and never blocks again silently", () =>
    Effect.gen(function* () {
      yield* setup([info({ PreToolUse: [sh("printf 'project policy\\n' >&2; exit 2")] })], 0)
      permissionDeny = true
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Echo this" }), resume: false })
      responses = [toolCallEvents("call-untrusted", "hello"), []]
      yield* session.resume(sessionID)
      expect(permissionAsserts).toHaveLength(1)
      expect(executions).toEqual(["hello"])
    }),
  )

  it.live("hook-produced tool errors are durable session events", () =>
    Effect.gen(function* () {
      yield* setup([info({ PreToolUse: [sh("printf 'blocked by policy\\n' >&2; exit 2")] })])
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Echo this" }), resume: false })
      responses = [toolCallEvents("call-replay", "hello"), []]
      yield* session.resume(sessionID)
      const events = yield* durableEvents
      expect(events.some((event) => JSON.stringify(event.data).includes("blocked by policy"))).toBe(true)
    }),
  )
})
