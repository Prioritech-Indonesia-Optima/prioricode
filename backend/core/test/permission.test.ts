import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Fiber, Layer } from "effect"
import { Agent } from "@prioricode/core/agent"
import { Database } from "@prioricode/core/database/database"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { EventBus } from "@prioricode/core/event"
import { Location } from "@prioricode/core/location"
import { Permission } from "@prioricode/core/permission"
import { PermissionTable } from "@prioricode/core/permission/sql"
import { PermissionSaved } from "@prioricode/core/permission/saved"
import { Project } from "@prioricode/core/project"
import { ProjectTable } from "@prioricode/core/project/sql"
import { AbsolutePath } from "@prioricode/core/schema"
import { Session } from "@prioricode/core/session"
import { SessionTable } from "@prioricode/core/session/sql"
import { SessionStore } from "@prioricode/core/session/store"
import { eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventBus.node,
      SessionStore.node,
      PermissionSaved.node,
      Agent.node,
      Permission.node,
    ]),
    [[Location.node, current]],
  ),
)

function setup(rules: Permission.Ruleset = []) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: Session.ID.make("ses_test"),
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        agent: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* setRules(rules)
  })
}

function setRules(rules: Permission.Ruleset) {
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
  })
}

function setMode(mode: Permission.Mode | null) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .update(SessionTable)
      .set({ permission_mode: mode })
      .where(eq(SessionTable.id, Session.ID.make("ses_test")))
      .run()
      .pipe(Effect.orDie)
  })
}

function insertSession(id: string, input: { parentID?: string; mode?: Permission.Mode } = {}) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionTable)
      .values({
        id: Session.ID.make(id),
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: id,
        version: "test",
        agent: "test",
        parent_id: input.parentID === undefined ? undefined : Session.ID.make(input.parentID),
        permission_mode: input.mode,
      })
      .run()
      .pipe(Effect.orDie)
  })
}

function assertion(input: Partial<Permission.AssertInput> = {}) {
  return {
    id: Permission.ID.create("per_test"),
    sessionID: Session.ID.make("ses_test"),
    action: "read",
    resources: ["src/index.ts"],
    ...input,
  } satisfies Permission.AssertInput
}

function waitForRequest() {
  return Effect.gen(function* () {
    const service = yield* Permission.Service
    const events = yield* EventBus.Service
    const asked = yield* Deferred.make<Permission.Request>()
    const unsubscribe = yield* events.listen((event) =>
      event.type === Permission.Event.Asked.type
        ? Deferred.succeed(asked, event.data as Permission.Request).pipe(Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const fiber = yield* service.assert(assertion()).pipe(Effect.forkScoped)
    const request = yield* Deferred.await(asked)
    return { service, fiber, request }
  })
}

describe("Permission", () => {
  it.effect("returns the evaluated effect and only queues prompts", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "allow" })
      expect(yield* service.list()).toEqual([])
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "deny" })
      expect(yield* service.list()).toEqual([])
      yield* setRules([])
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "ask" })
      expect(yield* service.get(Permission.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("evaluates against an explicit provider-turn agent", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.permissions.push({ action: "read", resource: "*", effect: "deny" })
        }),
      )
      const service = yield* Permission.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(yield* service.ask(assertion({ agent: Agent.ID.make("reviewer") }))).toMatchObject({ effect: "deny" })
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.permissions = []
        }),
      )
      expect(yield* service.ask(assertion({ agent: Agent.ID.make("reviewer") }))).toMatchObject({ effect: "ask" })
      expect(yield* service.get(Permission.ID.create("per_test"))).not.toHaveProperty("agent")
    }),
  )

  it.effect("allows and denies from explicit rules without asking", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service
      yield* service.assert(assertion())
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      const blocked = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(blocked).toBeInstanceOf(Permission.BlockedError)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("allows managed output reads without granting external directory access", () =>
    Effect.gen(function* () {
      yield* setup([
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
      ])
      const service = yield* Permission.Service

      expect(yield* service.ask(assertion({ resources: ["tool_123"] }))).toMatchObject({ effect: "allow" })
      expect(
        yield* service.ask(assertion({ action: "external_directory", resources: ["/tmp/tool-output/*"] })),
      ).toMatchObject({ effect: "deny" })
    }),
  )

  it.effect("uses build permissions when the Session agent is omitted", () =>
    Effect.gen(function* () {
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ agent: null })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.permissions = [{ action: "todowrite", resource: "*", effect: "allow" }]
        }),
      )

      const service = yield* Permission.Service
      expect(yield* service.ask(assertion({ action: "todowrite", resources: ["*"] }))).toEqual({
        id: Permission.ID.create("per_test"),
        effect: "allow",
      })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("denies omitted-agent permissions when no primary default agent exists", () =>
    Effect.gen(function* () {
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ agent: null })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => {
        editor.remove(Agent.ID.make("test"))
        editor.remove(Agent.ID.make("build"))
      })

      const service = yield* Permission.Service
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "deny" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("evaluates bash with the normal configured-rule semantics", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "*", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service
      const bash = assertion({ action: "bash", resources: ["pwd"] })
      expect(yield* service.ask(bash)).toEqual({ id: Permission.ID.create("per_test"), effect: "allow" })

      yield* setRules([])
      expect(yield* service.ask(bash)).toEqual({ id: Permission.ID.create("per_test"), effect: "ask" })
      expect(yield* service.get(Permission.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("uses saved bash approvals while preserving configured deny precedence", () =>
    Effect.gen(function* () {
      yield* setup()
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "bash", resources: ["pwd"] })

      const service = yield* Permission.Service
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toEqual({
        id: Permission.ID.create("per_test"),
        effect: "allow",
      })
      expect(yield* service.list()).toEqual([])

      yield* setRules([{ action: "bash", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toEqual({
        id: Permission.ID.create("per_test"),
        effect: "deny",
      })
    }),
  )

  it.effect("resolves an asked permission once", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, fiber, request } = yield* waitForRequest()
      expect(yield* service.list()).toEqual([request])
      expect(yield* service.forSession(request.sessionID)).toEqual([request])
      expect(yield* service.forSession(Session.ID.make("ses_other"))).toEqual([])
      expect(yield* service.get(request.id)).toEqual(request)
      yield* service.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(fiber)
      expect(yield* service.list()).toEqual([])
      expect(yield* service.get(request.id)).toBeUndefined()
    }),
  )

  it.effect("defects when an asked permission is declined", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, fiber, request } = yield* waitForRequest()
      yield* service.reply({ requestID: request.id, reply: "reject" })
      const exit = yield* Fiber.await(fiber)

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure")
        expect(
          exit.cause.reasons.some(
            (reason) => Cause.isDieReason(reason) && reason.defect instanceof Permission.DeclinedError,
          ),
        ).toBe(true)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("stores and removes saved resources for a project", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* Permission.Service
      const asked = yield* Deferred.make<Permission.Request>()
      const events = yield* EventBus.Service
      const unsubscribe = yield* events.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, event.data as Permission.Request).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service.assert(assertion({ save: ["src/*"] })).pipe(Effect.forkScoped)
      const request = yield* Deferred.await(asked)
      yield* service.reply({ requestID: request.id, reply: "always" })
      yield* Fiber.join(fiber)

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(PermissionTable).where(eq(PermissionTable.project_id, Project.ID.global)).all(),
      ).toMatchObject([{ action: "read", resource: "src/*" }])
      const saved = yield* PermissionSaved.Service
      const id = (yield* saved.list())[0]!.id
      expect(yield* saved.list()).toEqual([{ id, projectID: Project.ID.global, action: "read", resource: "src/*" }])
      yield* service.assert(assertion({ id: Permission.ID.create("per_next"), resources: ["src/next.ts"] }))
      yield* saved.remove(id)
      expect(yield* saved.list()).toEqual([])
    }),
  )

  it.effect("a saved wildcard allow satisfies broad asks but never a configured specific ask", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*.env", effect: "ask" }])
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "read", resources: ["*"] })

      const service = yield* Permission.Service
      // The default no-rule-matches ask (wildcard specificity) is satisfied by a saved wildcard.
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create("per_law_src"), resources: ["src/index.ts"] })),
      ).toEqual({ id: Permission.ID.create("per_law_src"), effect: "allow" })
      // A more-specific configured ask (`read *.env`) outranks the saved wildcard.
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create("per_law_env"), resources: ["project.env"] })),
      ).toEqual({ id: Permission.ID.create("per_law_env"), effect: "ask" })
      expect(yield* service.list()).toMatchObject([{ id: Permission.ID.create("per_law_env") }])

      // An equally- or more-specific saved approval does satisfy the specific ask.
      yield* saved.add({ projectID: Project.ID.global, action: "read", resources: ["project.env"] })
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create("per_law_env2"), resources: ["project.env"] })),
      ).toEqual({ id: Permission.ID.create("per_law_env2"), effect: "allow" })
    }),
  )

  it.effect("a configured deny still defeats a saved wildcard allow", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "deny" }])
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "read", resources: ["*"] })

      const service = yield* Permission.Service
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create("per_char_deny"), resources: ["src/index.ts"] })),
      ).toEqual({ id: Permission.ID.create("per_char_deny"), effect: "deny" })
    }),
  )

  it.effect("the always-reply fan-out never auto-approves a request a configured specific ask governs", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*.env", effect: "ask" }])
      const service = yield* Permission.Service
      const events = yield* EventBus.Service
      const askedFor = (requestID: Permission.ID) =>
        Effect.gen(function* () {
          const asked = yield* Deferred.make<Permission.Request>()
          const unsubscribe = yield* events.listen((event) =>
            event.type === Permission.Event.Asked.type && (event.data as Permission.Request).id === requestID
              ? Deferred.succeed(asked, event.data as Permission.Request).pipe(Effect.asVoid)
              : Effect.void,
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          return asked
        })
      const wideAsked = yield* askedFor(Permission.ID.create("per_char_src"))
      const envAsked = yield* askedFor(Permission.ID.create("per_char_env2"))
      const envFiber = yield* service
        .assert(assertion({ id: Permission.ID.create("per_char_env2"), resources: ["project.env"] }))
        .pipe(Effect.forkScoped)
      const srcFiber = yield* service
        .assert(assertion({ id: Permission.ID.create("per_char_src"), resources: ["src/index.ts"], save: ["*"] }))
        .pipe(Effect.forkScoped)

      const srcRequest = yield* Deferred.await(wideAsked)
      expect(yield* Deferred.await(envAsked)).toMatchObject({ resources: ["project.env"] })
      yield* service.reply({ requestID: srcRequest.id, reply: "always" })
      yield* Fiber.join(srcFiber)
      // The saved wildcard from the "always" reply is less specific than the configured
      // `read *.env` ask, so the pending .env request stays pending.
      expect(yield* service.list()).toMatchObject([{ id: Permission.ID.create("per_char_env2") }])
      yield* service.reply({ requestID: Permission.ID.create("per_char_env2"), reply: "once" })
      yield* Fiber.join(envFiber)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("ask-first mode prompts for modifying actions but not reads", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "*", resource: "*", effect: "allow" }])
      yield* setMode("ask-first")
      const service = yield* Permission.Service

      expect(
        yield* service.ask(assertion({ id: Permission.ID.create(), action: "read", resources: ["src/index.ts"] })),
      ).toMatchObject({ effect: "allow" })
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create(), action: "edit", resources: ["src/index.ts"] })),
      ).toMatchObject({ effect: "ask" })
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create(), action: "bash", resources: ["pwd"] })),
      ).toMatchObject({ effect: "allow" })
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create(), action: "bash", resources: ["git push *"] })),
      ).toMatchObject({ effect: "ask" })
      expect(
        yield* service.ask(
          assertion({ id: Permission.ID.create(), action: "bash", resources: ["bun test *", "git push *"] }),
        ),
      ).toMatchObject({ effect: "ask" })
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create(), action: "bash", resources: ["bun test *"] })),
      ).toMatchObject({ effect: "allow" })
    }),
  )

  it.effect("always-allow mode auto-allows tools but still guards destructive bash", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "*", resource: "*", effect: "deny" }])
      yield* setMode("always-allow")
      const service = yield* Permission.Service

      expect(
        yield* service.ask(assertion({ id: Permission.ID.create(), action: "edit", resources: ["src/index.ts"] })),
      ).toMatchObject({ effect: "allow" })
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create(), action: "bash", resources: ["pwd"] })),
      ).toMatchObject({ effect: "allow" })
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create(), action: "bash", resources: ["rm -rf /"] })),
      ).toMatchObject({ effect: "ask" })
      expect(
        yield* service.ask(
          assertion({ id: Permission.ID.create(), action: "bash", resources: ["mkfs.ext4 /dev/sda1"] }),
        ),
      ).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("child session follows the nearest ancestor's permission mode", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "*", resource: "*", effect: "deny" }])
      yield* setMode("always-allow")
      yield* insertSession("ses_child", { parentID: "ses_test" })
      const service = yield* Permission.Service
      expect(
        yield* service.ask(
          assertion({
            id: Permission.ID.create(),
            sessionID: Session.ID.make("ses_child"),
            action: "edit",
            resources: ["src/index.ts"],
          }),
        ),
      ).toMatchObject({ effect: "allow" })
    }),
  )

  it.effect("explicit child mode overrides the ancestor mode", () =>
    Effect.gen(function* () {
      yield* setup([])
      yield* setMode("always-allow")
      yield* insertSession("ses_child", { parentID: "ses_test", mode: "ask-first" })
      const service = yield* Permission.Service
      expect(
        yield* service.ask(
          assertion({
            id: Permission.ID.create(),
            sessionID: Session.ID.make("ses_child"),
            action: "edit",
            resources: ["src/index.ts"],
          }),
        ),
      ).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("mode resolves through an unset middle ancestor", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "*", resource: "*", effect: "deny" }])
      yield* setMode("ask-first")
      yield* insertSession("ses_mid", { parentID: "ses_test" })
      yield* insertSession("ses_leaf", { parentID: "ses_mid" })
      const service = yield* Permission.Service
      expect(
        yield* service.ask(
          assertion({
            id: Permission.ID.create(),
            sessionID: Session.ID.make("ses_leaf"),
            action: "edit",
            resources: ["src/index.ts"],
          }),
        ),
      ).toMatchObject({ effect: "ask" })
      expect(
        yield* service.ask(
          assertion({
            id: Permission.ID.create(),
            sessionID: Session.ID.make("ses_leaf"),
            action: "read",
            resources: ["src/index.ts"],
          }),
        ),
      ).toMatchObject({ effect: "deny" })
    }),
  )

  it.effect("default mode ignores the destructive guard", () =>
    Effect.gen(function* () {
      yield* setup([])
      yield* setMode(null)
      const service = yield* Permission.Service
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create(), action: "bash", resources: ["rm -rf /"] })),
      ).toMatchObject({ effect: "ask" })
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create(), action: "bash", resources: ["pwd"] })),
      ).toMatchObject({ effect: "ask" })
    }),
  )
})
