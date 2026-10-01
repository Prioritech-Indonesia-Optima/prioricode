import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@prioricode/core/effect/app-node-builder"
import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Location } from "@prioricode/core/location"
import { PermissionV2 } from "@prioricode/core/permission"
import { AbsolutePath, RelativePath } from "@prioricode/core/schema"
import { SessionV2 } from "@prioricode/core/session"
import { GlobTool } from "@prioricode/core/tool/glob"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { ToolOutputStore } from "@prioricode/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_glob_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let denyAction: string | undefined

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(
          input.action === denyAction ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void,
        ),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const reset = () => {
  assertions.length = 0
  denyAction = undefined
}

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GlobTool.node]), [
        [Location.node, activeLocation],
        [PermissionV2.node, permission],
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ]),
    ),
  )
}

const call = (input: typeof GlobTool.Input.Type, id = "call-glob") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "glob", input },
})

const seed = (tmp: string) =>
  Effect.gen(function* () {
    const write = (relative: string, content: string) =>
      Effect.promise(async () => {
        const target = path.join(tmp, relative)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, content)
      }).pipe(Effect.orDie)
    yield* write("a.ts", "needle\n")
    yield* write("b.txt", "other\n")
    yield* write("sub/c.ts", "first needle\nsecond needle\n")
    yield* write("sub/deep/d.txt", "needle\n")
    yield* write(".hidden/e.ts", "needle\n")
  })

const it = testEffect(Layer.empty)

describe("GlobTool", () => {
  it.live("advertises the glob definition and hides it when the glob action is denied", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["glob"])
            expect(yield* toolDefinitions(registry, [{ action: "glob", resource: "*", effect: "deny" }])).toEqual([])
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("asserts pattern-scoped permission with a wildcard save", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                yield* executeTool(registry, call({ pattern: "**/*.ts" }))
                expect(assertions).toHaveLength(1)
                expect(assertions[0]).toMatchObject({
                  sessionID,
                  agent: toolIdentity.agent,
                  action: "glob",
                  resources: ["**/*.ts"],
                  save: ["*"],
                  source: {
                    type: "tool",
                    messageID: toolIdentity.assistantMessageID,
                    callID: "call-glob",
                  },
                })
                // Characterization: current metadata carries no pattern key.
                expect(assertions[0]?.metadata).toEqual({ root: ".", path: undefined, limit: undefined })
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("returns absolute paths in model text and relative entries in structured output", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(registry, call({ pattern: "**/*.ts" }))
                expect(settled.result.type).toBe("text")
                // ripgrep traversal order is not contractual, so compare sorted.
                expect(String(settled.result.value).split("\n").sort()).toEqual(
                  [path.join(tmp.path, "a.ts"), path.join(tmp.path, "sub/c.ts")].sort(),
                )
                expect(settled.output?.structured).toHaveLength(2)
                expect(settled.output?.structured).toEqual(
                  expect.arrayContaining([
                    { path: RelativePath.make("a.ts"), type: "file" },
                    { path: RelativePath.make("sub/c.ts"), type: "file" },
                  ]),
                )
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("reports no files found when nothing matches", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                expect(yield* executeTool(registry, call({ pattern: "*.md" }))).toEqual({
                  type: "text",
                  value: "No files found",
                })
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("bounds the result count with limit", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(registry, call({ pattern: "**/*.ts", limit: 1 }))
                expect(settled.output?.structured).toHaveLength(1)
                expect(settled.result.type).toBe("text")
                expect(String(settled.result.value).split("\n")).toHaveLength(1)
                expect(assertions[0]?.metadata).toEqual({ root: ".", path: undefined, limit: 1 })
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("narrows the search to a relative path and records it in metadata", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(registry, call({ pattern: "**/*.ts", path: RelativePath.make("sub") }))
                expect(settled.output?.structured).toEqual([{ path: RelativePath.make("sub/c.ts"), type: "file" }])
                expect(assertions[0]?.metadata).toEqual({ root: "sub", path: "sub", limit: undefined })
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("settles as a model-visible failure when the search directory is missing", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const result = yield* executeTool(registry, call({ pattern: "*.ts", path: RelativePath.make("missing") }))
                expect(result.type).toBe("error")
                if (result.type === "error") expect(String(result.value)).toContain("Unable to find files matching *.ts")
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
