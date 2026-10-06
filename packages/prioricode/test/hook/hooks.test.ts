import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import path from "path"
import { Hook } from "@/hook"
import { Session as SessionNs } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { CrossSpawnSpawner } from "@prioricode/core/cross-spawn-spawner"
import { SessionProjector } from "@prioricode/core/session/projector"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { PermissionV1 } from "@prioricode/core/v1/permission"
import { testEffect, pollWithTimeout } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Hook.node,
      SessionNs.node,
      SessionStatus.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({})],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

const readFile = (dir: string, name: string) =>
  Effect.promise(() =>
    Bun.file(path.join(dir, name))
      .text()
      .catch(() => ""),
  )

const lineCount = (text: string) => text.split("\n").filter((line) => line.length > 0).length

const pre = {
  tool: "bash",
  sessionID: SessionID.make("ses_hook_test"),
  callID: "call_test",
  args: { command: "echo hi" },
}

// Hook commands are POSIX shell strings; Windows spawn coverage is tracked as a follow-up.
const posix = process.platform !== "win32"

describe("hook PreToolUse", () => {
  if (posix)
    it.instance(
      "exit 2 blocks with the stderr reason; a non-matching tool is unaffected",
      () =>
        Effect.gen(function* () {
          const hooks = yield* Hook.Service
          const block = yield* hooks.preToolUse(pre)
          expect(block).toContain("nope")
          expect(yield* hooks.preToolUse({ ...pre, tool: "read" })).toBeUndefined()
        }),
      { config: { hooks: { PreToolUse: [{ matcher: "bash", command: "echo nope >&2; exit 2" }] } } },
    )

  if (posix)
    it.instance(
      "receives a Claude-shaped JSON payload on stdin",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const hooks = yield* Hook.Service
          expect(yield* hooks.preToolUse(pre)).toBeUndefined()
          const payload = JSON.parse(yield* readFile(test.directory, "payload.json"))
          expect(payload).toMatchObject({
            hook_event_name: "PreToolUse",
            session_id: "ses_hook_test",
            tool_name: "bash",
            tool_input: { command: "echo hi" },
          })
          expect(payload.cwd).toBe(test.directory)
        }),
      { config: { hooks: { PreToolUse: [{ command: "cat > payload.json" }] } } },
    )

  if (posix)
    it.instance(
      "crashing or timing-out hooks never block and publish hook.failed",
      () =>
        Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const received = yield* Deferred.make<unknown>()
          const seen: string[] = []
          const unsub = yield* events.listen((event) => {
            seen.push(event.type)
            if (event.type !== "hook.failed") return Effect.void
            Deferred.doneUnsafe(received, Effect.succeed(event.data))
            return Effect.void
          })
          yield* Effect.addFinalizer(() => unsub)
          const hooks = yield* Hook.Service
          const block = yield* hooks.preToolUse(pre)
          expect(block).toBeUndefined()
          const data = (yield* pollWithTimeout(
            Effect.map(Deferred.await(received), (d) => d as Record<string, unknown>),
            `hook.failed was never published; seen=${JSON.stringify(seen)}`,
          )) as Record<string, unknown>
          expect(data.event).toBe("PreToolUse")
          expect(String(data.reason)).toMatch(/exited 1: boom/)
        }),
      { config: { hooks: { PreToolUse: [{ command: "echo boom >&2; exit 1" }] } } },
    )

  if (posix)
    it.instance(
      "hook environment is an allow-list: session identity present, secrets absent",
      () =>
        Effect.gen(function* () {
          process.env.PRIORICODE_TEST_SECRET_TOKEN = "leak-me"
          const test = yield* TestInstance
          const hooks = yield* Hook.Service
          expect(yield* hooks.preToolUse(pre)).toBeUndefined()
          const dump = yield* readFile(test.directory, "envdump.txt")
          expect(dump).toContain("PATH=")
          expect(dump).toContain("PRIORICODE_HOOK_DEPTH=1")
          expect(dump).toContain("PRIORICODE_SESSION_ID=ses_hook_test")
          expect(dump).not.toContain("leak-me")
          expect(dump).not.toContain("PRIORICODE_TEST_SECRET_TOKEN")
        }),
      { config: { hooks: { PreToolUse: [{ command: "env > envdump.txt" }] } } },
    )
})

describe("hook lifecycle", () => {
  if (posix)
    it.instance(
      "SessionStart fires for root sessions only",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const hooks = yield* Hook.Service
          yield* hooks.init()
          const sessions = yield* SessionNs.Service
          const root = yield* sessions.create({})
          yield* pollWithTimeout(
            Effect.gen(function* () {
              const marks = yield* readFile(test.directory, "marks.txt")
              return lineCount(marks) === 1 ? marks : undefined
            }),
            "SessionStart never fired for the root session",
          )
          yield* sessions.create({ parentID: root.id })
          const marks = yield* readFile(test.directory, "marks.txt")
          expect(lineCount(marks)).toBe(1)
        }),
      { config: { hooks: { SessionStart: [{ command: "echo start >> marks.txt" }] } } },
    )

  if (posix)
    it.instance(
      "Stop fires when the root session goes idle, not for subagent idles",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const hooks = yield* Hook.Service
          yield* hooks.init()
          const sessions = yield* SessionNs.Service
          const status = yield* SessionStatus.Service
          const root = yield* sessions.create({})
          const child = yield* sessions.create({ parentID: root.id })
          yield* status.set(child.id, { type: "idle" })
          yield* status.set(root.id, { type: "idle" })
          yield* pollWithTimeout(
            Effect.gen(function* () {
              const marks = yield* readFile(test.directory, "marks.txt")
              return lineCount(marks) === 1 ? marks : undefined
            }),
            "Stop never fired for the root session",
          )
          yield* Effect.sleep("300 millis")
          expect(lineCount(yield* readFile(test.directory, "marks.txt"))).toBe(1)
        }),
      { config: { hooks: { Stop: [{ command: "echo stop >> marks.txt" }] } } },
    )

  if (posix)
    it.instance(
      "Notification fires on permission requests",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const hooks = yield* Hook.Service
          yield* hooks.init()
          const events = yield* EventV2Bridge.Service
          yield* events.publish(PermissionV1.Event.Asked, {
            id: PermissionV1.ID.make("per_test1"),
            sessionID: SessionID.make("ses_hook_test"),
            permission: "bash",
            patterns: ["echo hi"],
            metadata: {},
            always: [],
          })
          yield* pollWithTimeout(
            Effect.gen(function* () {
              const dump = yield* readFile(test.directory, "note.json")
              return dump.length > 0 ? dump : undefined
            }),
            "Notification hook never fired",
          )
          const payload = JSON.parse(yield* readFile(test.directory, "note.json"))
          expect(payload.message).toContain("bash")
          expect(payload.notification_type).toBe("permission")
        }),
      { config: { hooks: { Notification: [{ command: "cat > note.json" }] } } },
    )

  if (posix)
    it.instance(
      "re-entrancy guard: a nested hook dispatch does not run configured commands",
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          process.env.PRIORICODE_HOOK_DEPTH = "1"
          try {
            const sessions = yield* SessionNs.Service
            yield* sessions.create({})
            const hooks = yield* Hook.Service
            expect(yield* hooks.preToolUse(pre)).toBeUndefined()
          } finally {
            delete process.env.PRIORICODE_HOOK_DEPTH
          }
          expect(lineCount(yield* readFile(test.directory, "marks.txt"))).toBe(0)
        }),
      {
        config: {
          hooks: {
            SessionStart: [{ command: "echo start >> marks.txt" }],
            PreToolUse: [{ command: "echo block >&2; exit 2" }],
          },
        },
      },
    )
})
