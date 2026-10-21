import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Project } from "@prioricode/core/project"
import { SessionLand } from "@prioricode/core/session/land"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "@/session/schema"
import { LandTool } from "@/tool/land"
import { NotFoundError } from "@/storage/storage"
import { Agent } from "@/agent/agent"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const projectID = Project.ID.global
const selfID = SessionID.make("ses_land_self")
const childID = SessionID.make("ses_land_child")
const strangerID = SessionID.make("ses_land_stranger")

const info = (id: SessionID, parentID?: SessionID) =>
  ({
    id,
    slug: id,
    projectID,
    directory: "/project",
    title: id,
    version: "1",
    ...(parentID === undefined ? {} : { parentID }),
    time: { created: Date.now(), updated: Date.now() },
  }) as Session.Info

const selfInfo = info(selfID)
const childInfo = info(childID, selfID)

const sessionLayer = Layer.mock(Session.Service, {
  get: (id: SessionID) => {
    const found = [selfInfo, childInfo].find((session) => session.id === id)
    return found ? Effect.succeed(found) : Effect.fail(new NotFoundError({ message: "not found" }))
  },
})

const calls: SessionLand.Input[] = []
const nextResult: { value: SessionLand.LandResult } = {
  value: { landed: true, branch: "prioricode/brave-fox", mergeSha: "abcdef1234567890", checkout: "synced" },
}

const landLayer = Layer.mock(SessionLand.Service, {
  land: (input: SessionLand.Input) => {
    calls.push(input)
    return Effect.succeed(nextResult.value)
  },
})

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      LayerNode.make({ service: Session.Service, layer: sessionLayer, deps: [] }),
      LayerNode.make({ service: SessionLand.Service, layer: landLayer, deps: [] }),
      Truncate.node,
      Agent.node,
    ]),
  ),
)

const ctx = {
  sessionID: selfID,
  messageID: MessageID.make("msg_land"),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const execute = Effect.fn("LandTest.execute")(function* (params: Record<string, unknown>) {
  calls.length = 0
  const toolInfo = yield* LandTool
  const tool = yield* toolInfo.init()
  return yield* tool.execute(params as never, ctx as never)
})

describe("tool.land", () => {
  it.instance("lands self and states the never-push contract", () =>
    Effect.gen(function* () {
      nextResult.value = {
        landed: true,
        branch: "prioricode/brave-fox",
        mergeSha: "abcdef1234567890",
        checkout: "synced",
      }
      const result = yield* execute({})
      expect(result.title).toBe("land:landed")
      expect(result.output).toContain("LANDED prioricode/brave-fox")
      expect(result.output).toContain("NOT PUSHED")
      expect(calls[0]?.sessionID).toBe(selfID)
      expect(calls[0]?.dryRun).toBeUndefined()
    }),
  )

  it.instance("passes dry_run and command through", () =>
    Effect.gen(function* () {
      nextResult.value = { landed: false, reason: "preview", files: ["a.ts"], dirtyPrimary: [] }
      const result = yield* execute({ dry_run: true, command: "bun test" })
      expect(result.title).toBe("land:preview")
      expect(result.output).toContain("a.ts")
      expect(result.output).toContain("landing would proceed")
      expect(calls[0]?.command).toBe("bun test")
      expect(calls[0]?.dryRun).toBe(true)
    }),
  )

  it.instance("renders conflict with owners and negotiation guidance", () =>
    Effect.gen(function* () {
      nextResult.value = {
        landed: false,
        reason: "conflict",
        paths: ["src/a.ts"],
        owners: [{ path: "src/a.ts", sessionID: "ses_peer" }],
      }
      const result = yield* execute({})
      expect(result.title).toBe("land:conflict")
      expect(result.output).toContain("nothing moved")
      expect(result.output).toContain("src/a.ts <- ses_peer")
      expect(result.output).toContain("sessions")
    }),
  )

  it.instance("defers on a dirty primary without touching it", () =>
    Effect.gen(function* () {
      nextResult.value = { landed: false, reason: "primary-dirty", paths: ["notes.md"] }
      const result = yield* execute({})
      expect(result.title).toBe("land:deferred")
      expect(result.output).toContain("DEFERRED")
      expect(result.output).toContain("Do not stash")
    }),
  )

  it.instance("blocks on a red verify tail", () =>
    Effect.gen(function* () {
      nextResult.value = { landed: false, reason: "verify-failed", command: "bun test", exit: 1, tail: "1 fail" }
      const result = yield* execute({})
      expect(result.title).toBe("land:red")
      expect(result.output).toContain("exited 1")
      expect(result.output).toContain("1 fail")
    }),
  )

  it.instance("renders merged-tree rollback", () =>
    Effect.gen(function* () {
      nextResult.value = {
        landed: false,
        reason: "merged-verify-failed",
        command: "sh check.sh",
        exit: 3,
        tail: "boom",
        reverted: true,
      }
      const result = yield* execute({})
      expect(result.title).toBe("land:red-merged")
      expect(result.output).toContain("ROLLED BACK")
      expect(result.output).toContain("main was reverted")
      expect(result.output).toContain("boom")
    }),
  )

  it.instance("refuses landing someone else's session", () =>
    Effect.gen(function* () {
      const result = yield* execute({ session: strangerID })
      expect(result.title).toBe("land:error")
      expect(result.output).toContain("no session")
      expect(calls.length).toBe(0)
    }),
  )

  it.instance("can land a child session", () =>
    Effect.gen(function* () {
      nextResult.value = {
        landed: true,
        branch: "prioricode/kind-owl",
        mergeSha: "beef1234567890ab",
        checkout: "stale",
        note: "manual sync",
      }
      const result = yield* execute({ session: childID })
      expect(result.title).toBe("land:landed")
      expect(result.output).toContain("WARNING: manual sync")
      expect(calls[0]?.sessionID).toBe(childID)
    }),
  )
})
