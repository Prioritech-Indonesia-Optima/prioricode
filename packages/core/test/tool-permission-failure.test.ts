import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Location } from "@prioricode/core/location"
import { PermissionV2 } from "@prioricode/core/permission"
import { AbsolutePath } from "@prioricode/core/schema"
import { SessionV2 } from "@prioricode/core/session"
import { GlobTool } from "@prioricode/core/tool/glob"
import { PermissionFailure } from "@prioricode/core/tool/permission-failure"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { Tool } from "@prioricode/core/tool/tool"
import { ToolOutputStore } from "@prioricode/core/tool-output-store"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_permission_failure_test")

const it = testEffect(Layer.empty)

describe("Tool.failure cause rendering", () => {
  test("keeps payload fields of message-less typed errors visible", () => {
    const failure = Tool.failure("Unable to edit src/a.ts", new PermissionV2.CorrectedError({ feedback: "use tabs" }))
    expect(failure.message).toContain("use tabs")
  })

  test("keeps plain error messages verbatim", () => {
    const failure = Tool.failure("Unable to read missing.txt", new Error("ENOENT: no such file or directory"))
    expect(failure.message).toBe("Unable to read missing.txt: ENOENT: no such file or directory")
  })

  test("falls back to the error name when an empty error carries no payload", () => {
    const failure = Tool.failure("Unable to run", new Error(""))
    expect(failure.message).toBe("Unable to run: Error")
  })
})

describe("PermissionFailure.fromError", () => {
  test("carries the user's correction feedback verbatim", () => {
    const failure = PermissionFailure.fromError(new PermissionV2.CorrectedError({ feedback: "match our lint rules" }))
    expect(failure.message).toContain("match our lint rules")
    expect(failure.message).toContain("Address the feedback before retrying")
  })

  test("names the blocking rules", () => {
    const failure = PermissionFailure.fromError(
      new PermissionV2.BlockedError({ rules: [{ action: "bash", resource: "git push *", effect: "deny" }] }),
    )
    expect(failure.message).toContain("bash git push * (deny)")
    expect(failure.message).toContain("Do not retry this action")
  })

  test("falls back to the active policy when no matching rules were captured", () => {
    const failure = PermissionFailure.fromError(new PermissionV2.BlockedError({ rules: [] }))
    expect(failure.message).toContain("the active permission policy")
  })

  test("reports a missing Session for the permission check", () => {
    const failure = PermissionFailure.fromError(new SessionV2.NotFoundError({ sessionID }))
    expect(failure.message).toContain(sessionID)
    expect(failure.message).toContain("no longer exists")
  })
})

describe("permission feedback survives real settlement", () => {
  const runWithDeniedPermission = (failure: PermissionV2.Error | SessionV2.NotFoundError) => {
    const permission = Layer.succeed(
      PermissionV2.Service,
      PermissionV2.Service.of({
        assert: () => Effect.fail(failure),
        ask: () => Effect.die("unused"),
        reply: () => Effect.die("unused"),
        get: () => Effect.die("unused"),
        forSession: () => Effect.die("unused"),
        list: () => Effect.die("unused"),
      }),
    )
    return Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const settled = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call" as const, id: "call-permission-failure", name: "glob", input: { pattern: "*.ts" } },
      })
      return settled.result
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GlobTool.node]), [
          [
            Location.node,
            Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make("/permission-failure-test") }))),
          ],
          [PermissionV2.node, permission],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ]),
      ),
    )
  }

  it.effect("a corrected permission decision reaches the model as the user's feedback, not the error tag", () =>
    Effect.gen(function* () {
      const result = yield* runWithDeniedPermission(new PermissionV2.CorrectedError({ feedback: "search src only" }))
      expect(result).toEqual({
        type: "error",
        value: 'The user rejected this action with feedback: "search src only". Address the feedback before retrying or choosing another approach.',
      })
    }),
  )

  it.effect("a blocked permission decision reaches the model with the governing rules", () =>
    Effect.gen(function* () {
      const result = yield* runWithDeniedPermission(
        new PermissionV2.BlockedError({ rules: [{ action: "glob", resource: "src/**", effect: "deny" }] }),
      )
      expect(result).toEqual({
        type: "error",
        value: "Blocked by permission rules: glob src/** (deny). Do not retry this action; explain or ask the user instead.",
      })
    }),
  )
})
