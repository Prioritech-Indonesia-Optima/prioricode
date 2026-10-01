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
import { GrepTool } from "@prioricode/core/tool/grep"
import { ToolRegistry } from "@prioricode/core/tool/registry"
import { ToolOutputStore } from "@prioricode/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_grep_tool_test")
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
      AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GrepTool.node]), [
        [Location.node, activeLocation],
        [PermissionV2.node, permission],
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ]),
    ),
  )
}

const call = (input: typeof GrepTool.Input.Type, id = "call-grep") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "grep", input },
})

const seed = (tmp: string) =>
  Effect.gen(function* () {
    const write = (relative: string, content: string) =>
      Effect.promise(async () => {
        const target = path.join(tmp, relative)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, content)
      }).pipe(Effect.orDie)
    yield* write("a.ts", "needle at the top\n")
    yield* write("notes.md", "nothing here\n")
    yield* write("sub/c.ts", "first needle\nsecond needle\n")
    yield* write("sub/deep/d.md", "needle in markdown\n")
    yield* write(".hidden/e.ts", "hidden needle\n")
  })

const it = testEffect(Layer.empty)

describe("GrepTool", () => {
  it.live("advertises the grep definition and hides it when the grep action is denied", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["grep"])
            expect(yield* toolDefinitions(registry, [{ action: "grep", resource: "*", effect: "deny" }])).toEqual([])
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("asserts pattern-scoped permission with a wildcard save and query metadata", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                yield* executeTool(registry, call({ pattern: "needle", include: "*.ts", limit: 100 }))
                expect(assertions).toHaveLength(1)
                expect(assertions[0]).toMatchObject({
                  sessionID,
                  agent: toolIdentity.agent,
                  action: "grep",
                  resources: ["needle"],
                  save: ["*"],
                  source: {
                    type: "tool",
                    messageID: toolIdentity.assistantMessageID,
                    callID: "call-grep",
                  },
                })
                expect(assertions[0]?.metadata).toEqual({
                  pattern: "needle",
                  root: ".",
                  path: undefined,
                  include: "*.ts",
                  limit: 100,
                })
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("formats one file's matches with absolute path headers and line numbers", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(registry, call({ pattern: "needle", path: RelativePath.make("sub/c.ts") }))
                // Characterization: match text keeps its trailing newline, so formatted
                // lines gain an extra blank line between consecutive matches.
                expect(settled.result).toEqual({
                  type: "text",
                  value: [
                    "Found 2 matches",
                    `${path.join(tmp.path, "sub/c.ts")}:`,
                    "  Line 1: first needle\n",
                    "  Line 2: second needle\n",
                  ].join("\n"),
                })
                expect(settled.output?.structured).toEqual([
                  {
                    entry: { path: RelativePath.make("sub/c.ts"), type: "file" },
                    line: 1,
                    offset: 0,
                    text: "first needle\n",
                    submatches: [{ text: "needle", start: 6, end: 12 }],
                  },
                  {
                    entry: { path: RelativePath.make("sub/c.ts"), type: "file" },
                    line: 2,
                    offset: 13,
                    text: "second needle\n",
                    submatches: [{ text: "needle", start: 7, end: 13 }],
                  },
                ])
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("filters files by the include glob and counts every match", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(registry, call({ pattern: "needle", include: "*.md" }))
                expect(settled.result.type).toBe("text")
                expect(String(settled.result.value)).toContain("Found 1 matches")
                expect(String(settled.result.value)).toContain(path.join(tmp.path, "sub/deep/d.md") + ":")
                expect(settled.output?.structured).toEqual([
                  {
                    entry: { path: RelativePath.make("sub/deep/d.md"), type: "file" },
                    line: 1,
                    offset: expect.any(Number),
                    text: "needle in markdown\n",
                    submatches: expect.any(Array),
                  },
                ])
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("searches hidden files because grep always runs ripgrep with --hidden", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(registry, call({ pattern: "hidden needle" }))
                expect(settled.output?.structured).toEqual([
                  {
                    entry: { path: RelativePath.make(".hidden/e.ts"), type: "file" },
                    line: 1,
                    offset: 0,
                    text: "hidden needle\n",
                    submatches: [{ text: "hidden needle", start: 0, end: 13 }],
                  },
                ])
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
                expect(yield* executeTool(registry, call({ pattern: "zzz-no-match" }))).toEqual({
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

  it.live("bounds the match count with limit", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(registry, call({ pattern: "needle", limit: 1 }))
                expect(settled.output?.structured).toHaveLength(1)
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("settles as a model-visible failure for an invalid regular expression", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return seed(tmp.path).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const result = yield* executeTool(registry, call({ pattern: "(unclosed" }))
                expect(result.type).toBe("error")
                if (result.type === "error") expect(String(result.value)).toContain("Unable to grep for (unclosed")
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
