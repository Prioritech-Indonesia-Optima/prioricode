import { describe, expect } from "bun:test"
import { PermissionV1 } from "@prioricode/core/v1/permission"
import { SessionProjector } from "@prioricode/core/session/projector"
import { CrossSpawnSpawner } from "@prioricode/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Effect, Fiber, Layer } from "effect"
import { Session as SessionNs } from "@/session/session"
import { SessionID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Permission } from "@/permission"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
      Permission.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

// Mirrors the effective ruleset `SessionTools.resolve` gives a subagent whose
// own agent allows everything: merge(agent.permission, session.permission).
const allowAllAgent: PermissionV1.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

const askChildEdit = Effect.fn("test.askChildEdit")(function* (
  session: SessionNs.Interface,
  permission: Permission.Interface,
  childID: SessionID,
) {
  const mode = yield* session.effectivePermissionMode(childID)
  const child = yield* session.get(childID)
  return yield* permission.ask({
    sessionID: childID,
    permission: "edit",
    patterns: ["src/generated.ts"],
    metadata: {},
    always: [],
    ruleset: Permission.merge(allowAllAgent, child.permission ?? []),
    mode,
  })
})

describe("subagent permission mode propagation (end to end)", () => {
  it.instance("an always-allow main session auto-allows the subagent's edit with no prompt", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const permission = yield* Permission.Service
      const main = yield* session.create({ title: "e2e-main" })
      const sub = yield* session.create({ parentID: main.id, title: "e2e-sub" })
      yield* session.setPermissionMode({ sessionID: main.id, mode: "always-allow" })

      yield* askChildEdit(session, permission, sub.id)

      expect(yield* permission.list()).toEqual([])
    }),
  )

  it.instance("an ask-first main session forces the subagent's edit to prompt the user", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const permission = yield* Permission.Service
      const main = yield* session.create({ title: "e2e-main-askfirst" })
      const sub = yield* session.create({ parentID: main.id, title: "e2e-sub-askfirst" })
      yield* session.setPermissionMode({ sessionID: main.id, mode: "ask-first" })

      const fiber = yield* askChildEdit(session, permission, sub.id).pipe(Effect.forkChild)
      const pending = yield* pollWithTimeout(
        Effect.gen(function* () {
          const list = yield* permission.list()
          return list.some((request) => request.sessionID === sub.id) ? list : undefined
        }),
        "subagent edit never surfaced a permission prompt",
      )
      expect(pending.filter((request) => request.sessionID === sub.id && request.permission === "edit")).toHaveLength(1)

      for (const request of pending) yield* permission.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(fiber)
    }),
  )

  it.instance("an explicit child mode overrides the main session's mode", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const permission = yield* Permission.Service
      const main = yield* session.create({ title: "e2e-main-override" })
      const sub = yield* session.create({ parentID: main.id, title: "e2e-sub-override" })
      yield* session.setPermissionMode({ sessionID: main.id, mode: "always-allow" })
      yield* session.setPermissionMode({ sessionID: sub.id, mode: "ask-first" })

      const fiber = yield* askChildEdit(session, permission, sub.id).pipe(Effect.forkChild)
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const list = yield* permission.list()
          return list.some((request) => request.sessionID === sub.id) ? list : undefined
        }),
        "explicitly ask-first child did not prompt despite always-allow parent",
      )
      const pending = yield* permission.list()
      for (const request of pending) yield* permission.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(fiber)
    }),
  )

  it.instance("destructive bash still prompts a subagent under an always-allow main session", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const permission = yield* Permission.Service
      const main = yield* session.create({ title: "e2e-main-destructive" })
      const sub = yield* session.create({ parentID: main.id, title: "e2e-sub-destructive" })
      yield* session.setPermissionMode({ sessionID: main.id, mode: "always-allow" })
      const mode = yield* session.effectivePermissionMode(sub.id)

      const fiber = yield* permission
        .ask({
          sessionID: sub.id,
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: Permission.merge(allowAllAgent, []),
          mode,
        })
        .pipe(Effect.forkChild)
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const list = yield* permission.list()
          return list.some((request) => request.sessionID === sub.id) ? list : undefined
        }),
        "destructive bash was auto-allowed despite the destructive guard",
      )
      const pending = yield* permission.list()
      for (const request of pending) yield* permission.reply({ requestID: request.id, reply: "reject" })
      const exit = yield* Fiber.await(fiber)
      expect(exit._tag).toBe("Failure")
    }),
  )
})
