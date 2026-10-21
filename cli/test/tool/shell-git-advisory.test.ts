import { describe, expect } from "bun:test"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Effect, Option } from "effect"
import path from "path"
import { Config } from "@/config/config"
import { ShellTool } from "../../src/tool/shell"
import { requireInstance, TestInstance } from "../fixture/fixture"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@prioricode/core/cross-spawn-spawner"
import { FSUtil } from "@prioricode/core/fs-util"
import { Plugin } from "../../src/plugin"
import { testEffect } from "../lib/effect"
import { Tool } from "@/tool/tool"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { FileTouch } from "@prioricode/core/file-touch"
import { FileAttribution } from "@/tool/file-attribution"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Sandbox } from "@/sandbox"
import { Database } from "@prioricode/core/database/database"
import { SessionTable } from "@prioricode/core/session/sql"
import { Slug } from "@prioricode/core/util/slug"
import type { InstanceContext } from "../../src/project/instance-context"

const shellLayer = LayerNode.compile(
  LayerNode.group([
    CrossSpawnSpawner.node,
    FSUtil.node,
    Plugin.node,
    Truncate.node,
    Config.node,
    Agent.node,
    RuntimeFlags.node,
    BackgroundJob.node,
    Sandbox.node,
    FileTouch.node,
    FileAttribution.node,
    Session.node,
    SessionStatus.node,
    Database.node,
  ]),
)
const it = testEffect(shellLayer)

const ctx = {
  sessionID: SessionID.make("ses_advisory_self"),
  messageID: MessageID.make("msg_advisory"),
  callID: "call_advisory",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const runShell = Effect.fn("ShellAdvisoryTest.run")(function* (command: string) {
  const shell = yield* ShellTool
  const tool = yield* shell.init()
  return yield* tool.execute({ command }, ctx as Tool.Context)
})

// Seed a sibling root session row directly — deterministic, without the
// create→projector event chain other suites cover on its own.
const seedPeer = Effect.fnUntraced(function* (instance: InstanceContext, directory: string, title: string) {
  const { db } = yield* Database.Service
  const id = SessionID.make("ses_advisory_peer")
  yield* db
    .insert(SessionTable)
    .values({
      id,
      project_id: instance.project.id,
      slug: Slug.create(),
      directory,
      path: "",
      title,
      version: "test",
      time_created: Date.now(),
      time_updated: Date.now(),
    })
    .run()
    .pipe(Effect.orDie)
  return id
})

const writeAndRecord = Effect.fnUntraced(function* (
  instance: InstanceContext,
  filepath: string,
  content: string,
  touch: { sessionID?: string; op: "modify" | "external" },
) {
  const fs = yield* FSUtil.Service
  const touches = yield* FileTouch.Service
  yield* fs.writeWithDirs(filepath, content)
  const info = yield* fs.stat(filepath).pipe(Effect.orDie)
  yield* touches.record({
    projectID: instance.project.id,
    path: filepath,
    op: touch.op,
    ...(touch.sessionID === undefined ? {} : { sessionID: touch.sessionID }),
    fingerprint: {
      mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
      size: Number(info.size),
    },
  })
})

describe("ShellTool git attribution advisory", () => {
  it.instance(
    "names the owning peer and states the ship rule for foreign dirty paths",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const instance = yield* requireInstance
        const peer = yield* seedPeer(instance, test.directory, "peer attribution test")
        yield* writeAndRecord(instance, path.join(test.directory, "peer-owned.txt"), "written by the peer\n", {
          sessionID: String(peer),
          op: "modify",
        })

        const result = yield* runShell("git status --porcelain")
        expect(result.output).toContain("Working-tree paths NOT authored by your session")
        expect(result.output).toContain(String(peer))
        expect(result.output).toContain("peer attribution test")
        expect(result.output).toContain("Rule: before committing or staging")
      }),
    { git: true },
  )

  it.instance(
    "stays silent for a solo session even with foreign dirty paths",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const instance = yield* requireInstance
        yield* writeAndRecord(instance, path.join(test.directory, "nobody.txt"), "external content\n", {
          op: "external",
        })

        const result = yield* runShell("git status --porcelain")
        expect(result.output).toContain("nobody.txt")
        expect(result.output).not.toContain("NOT authored by your session")
      }),
    { git: true },
  )

  it.instance(
    "reminds the committing session to add a PrioriCode-Session trailer",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const instance = yield* requireInstance
        yield* runShell("git commit --allow-empty -m base")
        yield* writeAndRecord(instance, path.join(test.directory, "mine.txt"), "mine\n", {
          sessionID: String(ctx.sessionID),
          op: "modify",
        })
        yield* runShell("git add mine.txt")
        const commit = yield* runShell('git commit -m "ship mine"')
        expect(commit.output).toContain("Commit provenance:")
        expect(commit.output).toContain("PrioriCode-Session: " + String(ctx.sessionID))
      }),
    { git: true },
  )
})
