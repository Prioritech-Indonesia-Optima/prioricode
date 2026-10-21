export * as ApplyPatchTool from "./apply-patch"

import { ToolFailure } from "@prioricode/llm"
import { FileDiff } from "@prioricode/schema/file-diff"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { EditObserver } from "../edit-observer"
import { FileMutation } from "../file-mutation"
import { FileTouch } from "../file-touch"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { Patch } from "../patch"
import { Permission } from "../permission"
import { SessionStore } from "../session/store"
import { PermissionFailure } from "./permission-failure"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolTouchRecord } from "./touch-record"

export const name = "apply_patch"

export const Input = Schema.Struct({
  patchText: Schema.String.annotate({
    description:
      "The full patch text describing add, update, and delete operations — sections wrapped in '*** Begin Patch' and '*** End Patch'",
  }),
})

export const Applied = Schema.Struct({
  type: Schema.Literals(["add", "update", "delete"]),
  resource: Schema.String,
  target: Schema.String,
})

export const Output = Schema.Struct({
  applied: Schema.Array(Applied),
  files: Schema.Array(FileDiff.Info),
  formatted: Schema.Boolean.pipe(Schema.optional),
  diagnostics: Schema.String.pipe(Schema.optional),
  snapshot: Schema.String.pipe(Schema.optional),
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) =>
  [
    "Applied patch sequentially:",
    ...output.applied.map(
      (item) => `${item.type === "add" ? "A" : item.type === "delete" ? "D" : "M"} ${item.resource}`,
    ),
    ...(output.diagnostics === undefined
      ? []
      : [`LSP errors detected in these files, please fix:\n${output.diagnostics}`]),
  ].join("\n")

type Prepared =
  | (Extract<Patch.Hunk, { readonly type: "add" | "delete" }> & {
      readonly target: LocationMutation.Target
      readonly before: string
      readonly after: string
    })
  | (Extract<Patch.Hunk, { readonly type: "update" }> & {
      readonly target: LocationMutation.Target
      readonly source: Uint8Array
      readonly content: string
      readonly before: string
      readonly after: string
    })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const fs = yield* FSUtil.Service
    const permission = yield* Permission.Service
    const observer = yield* EditObserver.Service
    const recorder = yield* ToolTouchRecord.makeRecorder()

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description:
              "Edit files with a file-oriented patch format — all add, update, and delete operations in one call, applied sequentially.\n" +
              "When: several related file changes belong in one step. It is atomic in intent, not in effect: if a later operation fails, earlier ones remain applied and the failure reports them explicitly. Moves and rollback are not supported.\n" +
              "How: wrap sections in '*** Begin Patch' / '*** End Patch'; per file '*** Add File: <path>' (every line prefixed '+'), '*** Update File: <path>' ('-' old lines, '+' new lines, optional '@@' context markers), or '*** Delete File: <path>'. Targets resolve within the active Location and are prepared into a diff preview before approval; a denied call discloses only the permission outcome.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
            execute: (input, context) => {
              const applied: Array<typeof Applied.Type> = []
              const fail = (path: string, error?: unknown) => {
                const prefix =
                  applied.length === 0
                    ? `Unable to apply patch at ${path}`
                    : `Patch partially applied before failing at ${path}. Applied: ${applied.map((item) => item.resource).join(", ")}`
                return Tool.failure(prefix, error)
              }
              return Effect.gen(function* () {
                const source = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }
                if (!input.patchText.trim()) return yield* new ToolFailure({ message: "patchText is required" })
                const hunks = yield* Effect.try({
                  try: () => Patch.parse(input.patchText),
                  catch: (cause) => Tool.failure("apply_patch verification failed", cause),
                })
                if (hunks.length === 0) return yield* new ToolFailure({ message: "patch rejected: empty patch" })
                const move = hunks.find((hunk) => hunk.type === "update" && hunk.movePath !== undefined)
                if (move) return yield* new ToolFailure({ message: "apply_patch moves are not supported yet" })

                const targets: Array<{ readonly hunk: Patch.Hunk; readonly target: LocationMutation.Target }> = []
                for (const hunk of hunks)
                  targets.push({ hunk, target: yield* mutation.resolve({ path: hunk.path, kind: "file" }) })
                // Operations are prepared (targets stat'ed and read, replacements derived) before
                // approval so the permission dialog can show the resulting diff. A denied call
                // always settles as the permission outcome: preparation failures stay model-invisible
                // until the approval decision, and writes never happen without approval.
                const preparation = yield* Effect.gen(function* () {
                  const prepared: Prepared[] = []
                  for (const { hunk, target } of targets) {
                    yield* Effect.gen(function* () {
                      if (hunk.type === "add") {
                        prepared.push({
                          ...hunk,
                          target,
                          before: "",
                          after:
                            hunk.contents.endsWith("\n") || hunk.contents === "" ? hunk.contents : `${hunk.contents}\n`,
                        })
                        return
                      }
                      if ((yield* fs.stat(target.canonical)).type !== "File") yield* fail(hunk.path)
                      const source = yield* fs.readFile(target.canonical)
                      const original = new TextDecoder("utf-8", { ignoreBOM: true }).decode(source)
                      const before = original.replace(/^\uFEFF/, "")
                      if (hunk.type === "delete") {
                        prepared.push({ ...hunk, target, before, after: "" })
                        return
                      }
                      const update = yield* Effect.try({
                        try: () => Patch.derive(hunk.path, hunk.chunks, original),
                        catch: (cause) => fail(hunk.path, cause),
                      })
                      prepared.push({
                        ...hunk,
                        target,
                        source,
                        content: Patch.joinBom(update.content, update.bom),
                        before,
                        after: update.content,
                      })
                    }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : fail(hunk.path, error))))
                  }
                  return prepared
                }).pipe(
                  Effect.map((prepared) => ({ _tag: "ready" as const, prepared, patchFiles: prepared.map(patchFile) })),
                  Effect.catch((error) =>
                    Effect.succeed({
                      _tag: "failure" as const,
                      failure: error instanceof ToolFailure ? error : fail("patch", error),
                    }),
                  ),
                )

                const externalDirectories = new Map<string, LocationMutation.ExternalDirectoryAuthorization>()
                for (const { target } of targets) {
                  const external = target.externalDirectory
                  if (external) externalDirectories.set(external.resource, external)
                }
                for (const external of externalDirectories.values()) {
                  yield* permission
                    .assert({
                      ...LocationMutation.externalDirectoryPermission(external),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source,
                    })
                    .pipe(Effect.mapError(PermissionFailure.fromError))
                }
                yield* permission
                  .assert({
                    action: "edit",
                    resources: [...new Set(targets.map(({ target }) => target.resource))],
                    save: ["*"],
                    metadata:
                      preparation._tag === "ready"
                        ? {
                            filepath: targets[0]?.target.resource ?? "",
                            diff: preparation.patchFiles.map((file) => file.patch).join("\n"),
                          }
                        : { filepath: targets[0]?.target.resource ?? "" },
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  })
                  .pipe(Effect.mapError(PermissionFailure.fromError))

                if (preparation._tag === "failure") return yield* preparation.failure
                const prepared = preparation.prepared
                const patchFiles = preparation.patchFiles
                yield* Effect.forEach(
                  prepared,
                  (change) =>
                    Effect.gen(function* () {
                      if (change.type === "add") {
                        const result = yield* files.create({
                          target: change.target,
                          content:
                            change.contents.endsWith("\n") || change.contents === ""
                              ? change.contents
                              : `${change.contents}\n`,
                        })
                        applied.push({ type: change.type, resource: result.resource, target: result.target })
                        return
                      }
                      if (change.type === "delete") {
                        const result = yield* files.remove({ target: change.target })
                        applied.push({ type: change.type, resource: result.resource, target: result.target })
                        return
                      }
                      const result = yield* files.writeIfUnchanged({
                        target: change.target,
                        expected: change.source,
                        content: change.content,
                      })
                      applied.push({ type: change.type, resource: result.resource, target: result.target })
                    }).pipe(Effect.mapError((error) => fail(change.path, error))),
                  { discard: true },
                )
                const observation = yield* observer.afterEdit(applied.map((item) => item.target))
                yield* ToolTouchRecord.recordWrites(
                  recorder,
                  context,
                  applied.map((item) => ({
                    path: item.target,
                    op:
                      item.type === "add"
                        ? ("create" as const)
                        : item.type === "delete"
                          ? ("delete" as const)
                          : ("modify" as const),
                  })),
                )
                return { applied, files: patchFiles, ...observation }
              }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : fail("patch", error))))
            },
          }),
          "edit",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/apply-patch",
  layer,
  deps: [
    ToolRegistry.node,
    LocationMutation.node,
    FileMutation.node,
    FSUtil.node,
    Permission.node,
    EditObserver.node,
    FileTouch.node,
    Location.node,
    SessionStore.node,
  ],
})

function patchFile(change: Prepared): typeof FileDiff.Info.Type {
  const counts = diffLines(change.before, change.after).reduce(
    (result, item) => ({
      additions: result.additions + (item.added ? (item.count ?? 0) : 0),
      deletions: result.deletions + (item.removed ? (item.count ?? 0) : 0),
    }),
    { additions: 0, deletions: 0 },
  )
  return {
    file: change.target.resource,
    patch: createTwoFilesPatch(change.target.resource, change.target.resource, change.before, change.after),
    status: change.type === "add" ? "added" : change.type === "delete" ? "deleted" : "modified",
    ...counts,
  }
}
