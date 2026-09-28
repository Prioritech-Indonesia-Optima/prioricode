import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@prioricode/core/config"
import { ConfigHooks } from "@prioricode/core/config/hooks"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { Hook } from "@prioricode/core/hook/index"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Location } from "@prioricode/core/location"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionV2 } from "@prioricode/core/session"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "prioricode-hook-test-"))
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(directory) })),
)
const sessionID = SessionV2.ID.make("ses_hook_engine_test")

const command = (event: string, script: string) =>
  new ConfigHooks.HookCommand({ command: [process.execPath, "-e", readStdin(event, script)] })

const readStdin = (event: string, script: string) =>
  `let data = "";process.stdin.on("data", (chunk) => (data += chunk));process.stdin.on("end", () => {const payload = ${
    event === "raw" ? "{}" : "JSON.parse(data)"
  };${script}});`

const globalDoc = (hooks: ConfigHooks.Info) =>
  new Config.Document({
    type: "document",
    path: "/home/user/.config/prioricode/prioricode.json",
    info: new Config.Info({ hooks }),
  })

const projectDoc = (hooks: ConfigHooks.Info) =>
  new Config.Document({
    type: "document",
    path: path.join(directory, ".prioricode", "prioricode.json"),
    info: new Config.Info({ hooks }),
  })

const harness = (documents: readonly Config.Document[]) =>
  testEffect(
    AppNodeBuilder.build(LayerNode.group([Hook.node]), [
      [
        Config.node,
        Layer.succeed(
          Config.Service,
          Config.Service.of({ entries: () => Effect.succeed([...documents]) }),
        ),
      ],
      [Location.node, locationLayer],
    ]),
  )

const base = { sessionID, allowProject: true } as const
const posixOnly = process.platform === "win32" ? describe.skip : describe

const info = (input: Partial<ConstructorParameters<typeof ConfigHooks.Info>[0]>) => new ConfigHooks.Info(input)

posixOnly("hook engine", () => {
  const blocking = harness([globalDoc(info({ PreToolUse: [new ConfigHooks.HookCommand({ command: "printf 'not allowed\\n' >&2; exit 2" })] }))])
  blocking.live("PreToolUse exit 2 blocks with the stderr reason", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(yield* hook.preToolUse({ ...base, tool: "bash", callID: "call_1", toolInput: { command: "ls" } })).toEqual({
        _tag: "Block",
        reason: "not allowed",
      })
    }),
  )

  const silentBlock = harness([globalDoc(info({ PreToolUse: [new ConfigHooks.HookCommand({ command: "exit 2" })] }))])
  silentBlock.live("exit 2 without output uses the default reason", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(yield* hook.preToolUse({ ...base, tool: "bash" })).toEqual({
        _tag: "Block",
        reason: "Blocked by a configured PreToolUse hook.",
      })
    }),
  )

  const mixed = harness([
    globalDoc(
      info({
        PreToolUse: [new ConfigHooks.HookCommand({ matcher: "edit*", command: "exit 2" })],
        PostToolUse: [new ConfigHooks.HookCommand({ command: "true" })],
        Stop: [
          new ConfigHooks.HookCommand({ command: "printf 'first stop\\n' >&2; exit 2" }),
          new ConfigHooks.HookCommand({ command: "exit 0" }),
          new ConfigHooks.HookCommand({ command: "printf 'second stop\\n' >&2; exit 2" }),
        ],
      }),
    ),
  ])

  mixed.live("matcher selects by tool name wildcard", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(yield* hook.preToolUse({ ...base, tool: "bash" })).toEqual({ _tag: "Allow" })
      expect(yield* hook.preToolUse({ ...base, tool: "edit-write" })).toMatchObject({ _tag: "Block" })
    }),
  )

  mixed.live("stop collects every exit-2 reason in order", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(yield* hook.stop({ ...base, stopHookActive: false })).toEqual({
        _tag: "Continue",
        reason: "first stop\n\nsecond stop",
      })
    }),
  )

  const payload = harness([
    globalDoc(
      info({
        PreToolUse: [
          command(
            "meta",
            `const ok = payload.hook_event_name === "PreToolUse" && payload.session_id === "ses_hook_engine_test" && payload.tool_name === "bash" && payload.tool_input.cmd === 1 && payload.tool_use_id === "call_9" && payload.cwd === ${JSON.stringify(
              directory,
            )};process.stderr.write(ok ? "payload-ok" : "payload-bad " + data);process.exit(2)`,
          ),
        ],
      }),
    ),
  ])

  payload.live("event payload arrives as JSON on stdin", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(yield* hook.preToolUse({ ...base, tool: "bash", callID: "call_9", toolInput: { cmd: 1 } })).toEqual({
        _tag: "Block",
        reason: "payload-ok",
      })
    }),
  )

  const failing = harness([
    globalDoc(
      info({
        PreToolUse: [
          new ConfigHooks.HookCommand({ command: "exit 1" }),
          new ConfigHooks.HookCommand({ command: ["/nonexistent/hook-binary"] }),
          new ConfigHooks.HookCommand({ command: "printf 'boom' >&2; exit 7" }),
          new ConfigHooks.HookCommand({ command: "sleep 5", timeout: 1 }),
        ],
      }),
    ),
  ])

  failing.live("crashes, nonzero exits, and timeouts all fail open", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(yield* hook.preToolUse({ ...base, tool: "bash" })).toEqual({ _tag: "Allow" })
    }),
  )

  failing.live("timeout kills the hook instead of waiting for it", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      const start = yield* Effect.sync(() => Date.now())
      expect(yield* hook.preToolUse({ ...base, tool: "bash" })).toEqual({ _tag: "Allow" })
      const elapsed = (yield* Effect.sync(() => Date.now())) - start
      expect(elapsed).toBeLessThan(4_000)
    }),
  )

  const env = harness([
    globalDoc(
      info({
        PreToolUse: [
          command(
            "raw",
            `const report = { secret: process.env.PRIORICODE_TEST_SECRET ?? null, hasPath: Boolean(process.env.PATH), depth: process.env.PRIORICODE_HOOK_DEPTH ?? null };process.stderr.write(JSON.stringify(report));process.exit(2)`,
          ),
        ],
      }),
    ),
  ])

  env.live("environment is allowlisted, secrets stripped, depth incremented", () =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          process.env.PRIORICODE_TEST_SECRET = "leak-me"
        }),
        () => Effect.sync(() => delete process.env.PRIORICODE_TEST_SECRET),
      )
      const hook = yield* Hook.Service
      const outcome = yield* hook.preToolUse({ ...base, tool: "bash" })
      expect(outcome).toMatchObject({ _tag: "Block" })
      if (outcome._tag !== "Block") return
      expect(JSON.parse(outcome.reason)).toEqual({ secret: null, hasPath: true, depth: "1" })
    }),
  )

  const depth = harness([globalDoc(info({ PreToolUse: [new ConfigHooks.HookCommand({ command: "exit 2" })] }))])
  depth.live("re-entrancy depth cap disables hooks entirely", () =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          process.env.PRIORICODE_HOOK_DEPTH = "3"
        }),
        () => Effect.sync(() => delete process.env.PRIORICODE_HOOK_DEPTH),
      )
      const hook = yield* Hook.Service
      expect(yield* hook.preToolUse({ ...base, tool: "bash" })).toEqual({ _tag: "Allow" })
    }),
  )

  const notes = harness([
    globalDoc(
      info({
        PostToolUse: [
          new ConfigHooks.HookCommand({ command: "printf 'note one'" }),
          command("meta", `process.stdout.write("y".repeat(9000))`),
        ],
      }),
    ),
  ])

  notes.live("PostToolUse stdout becomes one framed, capped note", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      const outcome = yield* hook.postToolUse({ ...base, tool: "bash", toolOutput: "done" })
      expect(outcome._tag).toBe("Note")
      if (outcome._tag !== "Note") return
      expect(outcome.note).toContain("Output from configured PostToolUse hooks (untrusted")
      expect(outcome.note).toContain("note one")
      expect(outcome.note).toContain("yyyy")
      expect(outcome.note.length).toBeLessThanOrEqual("Output from configured PostToolUse hooks (untrusted command output, not model or tool output):\n".length + 4000)
    }),
  )

  const silent = harness([globalDoc(info({ PostToolUse: [new ConfigHooks.HookCommand({ command: "true" })] }))])
  silent.live("silent PostToolUse success is observation only", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(yield* hook.postToolUse({ ...base, tool: "bash" })).toEqual({ _tag: "Observed" })
    }),
  )

  const scoped = harness([
    globalDoc(info({ PreToolUse: [new ConfigHooks.HookCommand({ command: "printf 'global blocks\\n' >&2; exit 2" })] })),
    projectDoc(info({ SessionStart: [command("raw", "0")], Stop: [new ConfigHooks.HookCommand({ command: "exit 2" })] })),
  ])
  const onlyGlobal = harness([globalDoc(info({ PreToolUse: [new ConfigHooks.HookCommand({ command: "exit 2" })] }))])

  scoped.live("project hooks only run when trusted", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(hook.hasProjectHooks()).toBe(true)
      expect(yield* hook.stop({ ...base, allowProject: false })).toEqual({ _tag: "Allow" })
      expect(yield* hook.stop({ ...base, allowProject: true })).toMatchObject({ _tag: "Continue" })
    }),
  )

  scoped.live("global hooks are unaffected by project trust", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(yield* hook.preToolUse({ ...base, allowProject: false, tool: "bash" })).toMatchObject({ _tag: "Block" })
    }),
  )

  onlyGlobal.live("global-only config reports no project hooks", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(hook.hasProjectHooks()).toBe(false)
      expect(hook.projectHash()).toBe(Hook.projectHookHash([]))
    }),
  )

  const start = harness([globalDoc(info({ SessionStart: [command("meta", `require("fs").writeFileSync(payload.cwd + "/start.marker", payload.session_id + ":" + payload.source)`)] }))])
  start.live("SessionStart delivers its payload and runs", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      fs.rmSync(path.join(directory, "start.marker"), { force: true })
      yield* hook.sessionStart({ ...base })
      expect(fs.readFileSync(path.join(directory, "start.marker"), "utf8")).toBe("ses_hook_engine_test:new")
    }),
  )

  const argv = harness([globalDoc(info({ PreToolUse: [command("raw", 'process.stderr.write("direct-spawn");process.exit(2)')] }))])
  argv.live("argv-array commands spawn without a shell", () =>
    Effect.gen(function* () {
      const hook = yield* Hook.Service
      expect(yield* hook.preToolUse({ ...base, tool: "bash" })).toEqual({ _tag: "Block", reason: "direct-spawn" })
    }),
  )
})

test("merged concatenates documents in order with scope labels", () => {
  const configDoc = (path: string, hooks: ConfigHooks.Info) => ({ path, info: new Config.Info({ hooks }) })
  const entries = ConfigHooks.merged(
    [
      configDoc("/global/prioricode.json", info({ PreToolUse: [new ConfigHooks.HookCommand({ command: "global-1" })] })),
      configDoc(path.join(directory, ".prioricode", "prioricode.json"), info({ PreToolUse: [new ConfigHooks.HookCommand({ command: "project-1" })] })),
      configDoc("/global/prioricode.json", info({ PreToolUse: [new ConfigHooks.HookCommand({ command: "global-2" })] })),
    ],
    directory,
  )
  expect(entries.PreToolUse.map((entry) => [entry.command, entry.scope])).toEqual([
    ["global-1", "global"],
    ["project-1", "project"],
    ["global-2", "global"],
  ])
  expect(ConfigHooks.has(entries)).toBe(true)
  expect(ConfigHooks.has({ PreToolUse: [], PostToolUse: [], Stop: [], SessionStart: [] })).toBe(false)
})

test("project hash is stable per content and changes with the commands", () => {
  const entry = (command: string, scope: "global" | "project"): ConfigHooks.Entry => ({ command, scope })
  expect(Hook.projectHookHash([entry("a", "project"), entry("b", "project")])).toBe(
    Hook.projectHookHash([entry("a", "project"), entry("b", "project")]),
  )
  expect(Hook.projectHookHash([entry("a", "project")])).not.toBe(Hook.projectHookHash([entry("b", "project")]))
  expect(Hook.projectHookHash([entry("a", "project")])).not.toBe(Hook.projectHookHash([]))
})
