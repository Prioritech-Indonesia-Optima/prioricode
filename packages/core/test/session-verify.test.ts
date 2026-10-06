import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { AppProcess } from "@prioricode/core/process"
import { ConfigVerify } from "@prioricode/core/config/verify"
import { Database } from "@prioricode/core/database/database"
import { EventV2 } from "@prioricode/core/event"
import { FSUtil } from "@prioricode/core/fs-util"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionV2 } from "@prioricode/core/session"
import { SessionExecution } from "@prioricode/core/session/execution"
import { SessionInput } from "@prioricode/core/session/input"
import { SessionProjector } from "@prioricode/core/session/projector"
import { SessionStore } from "@prioricode/core/session/store"
import { SessionVerify } from "@prioricode/core/session/runner/verify"
import { ProjectV2 } from "@prioricode/core/project"
import { testEffect } from "./lib/effect"

const directories: string[] = []
const makeDirectory = async (files: Record<string, string>) => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "prioricode-verify-")))
  directories.push(dir)
  for (const [name, contents] of Object.entries(files)) await fs.writeFile(path.join(dir, name), contents, "utf8")
  return dir
}

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      FSUtil.node,
      AppProcess.node,
    ]),
    [
      [SessionExecution.node, SessionExecution.noopLayer],
      [
        ProjectV2.node,
        Layer.succeed(
          ProjectV2.Service,
          ProjectV2.Service.of({
            resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
            directories: () => Effect.succeed([]),
            commit: () => Effect.void,
          }),
        ),
      ],
    ],
  ),
)

const verifierFor = Effect.fn("test.verifierFor")(function* (directory: string, config: ConfigVerify.Info | undefined) {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  const fsUtil = yield* FSUtil.Service
  const appProcess = yield* AppProcess.Service
  const sessions = yield* SessionV2.Service
  const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
  const verifier = yield* SessionVerify.make({
    db,
    events,
    fs: fsUtil,
    process: appProcess,
    directory,
    sessionID: created.id,
    config,
  })
  return { verifier, sessionID: created.id, db }
})

describe("SessionVerify", () => {
  afterAll(async () => {
    for (const dir of directories) await fs.rm(dir, { recursive: true, force: true })
  })

  it.effect("stays silent until a mutating tool ran", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory({}))
      const { verifier } = yield* verifierFor(dir, new ConfigVerify.Info({ command: "exit 1" }))
      expect(yield* verifier.beforeFinish()).toBe(false)
      verifier.recordMutation("bash")
      expect(yield* verifier.beforeFinish()).toBe(false)
    }),
  )

  it.effect("continues the drain once with a failure steering prompt for a seeded broken check", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        makeDirectory({ "fail.sh": "#!/bin/sh\necho broken-build-output >&2\nexit 3\n" }),
      )
      yield* Effect.promise(() => fs.chmod(path.join(dir, "fail.sh"), 0o755))
      const { verifier, sessionID, db } = yield* verifierFor(dir, new ConfigVerify.Info({ command: "sh fail.sh" }))
      verifier.recordMutation("write")
      expect(yield* verifier.beforeFinish()).toBe(true)
      expect(yield* SessionInput.hasPending(db, sessionID, "steer")).toBe(true)
      // The second finish is silent: bounded attempts prevent a verification loop.
      verifier.recordMutation("write")
      expect(yield* verifier.beforeFinish()).toBe(false)
      expect(yield* SessionInput.hasPending(db, sessionID, "steer")).toBe(true)
    }),
  )

  it.effect("passes silently when the verification command succeeds", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory({ "ok.sh": "#!/bin/sh\nexit 0\n" }))
      yield* Effect.promise(() => fs.chmod(path.join(dir, "ok.sh"), 0o755))
      const { verifier } = yield* verifierFor(dir, new ConfigVerify.Info({ command: "sh ok.sh" }))
      verifier.recordMutation("edit")
      expect(yield* verifier.beforeFinish()).toBe(false)
    }),
  )

  it.effect("auto-detects the package.json test script", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        makeDirectory({
          "package.json": JSON.stringify({ scripts: { test: "exit 7" } }),
          "fail.sh": "",
        }),
      )
      const { verifier, sessionID, db } = yield* verifierFor(dir, undefined)
      verifier.recordMutation("apply_patch")
      expect(yield* verifier.beforeFinish()).toBe(true)
      expect(yield* SessionInput.hasPending(db, sessionID, "steer")).toBe(true)
    }),
  )

  it.effect("respects the disabled switch", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => makeDirectory({}))
      const { verifier } = yield* verifierFor(dir, new ConfigVerify.Info({ command: "exit 1", enabled: false }))
      verifier.recordMutation("edit")
      expect(yield* verifier.beforeFinish()).toBe(false)
    }),
  )
})
