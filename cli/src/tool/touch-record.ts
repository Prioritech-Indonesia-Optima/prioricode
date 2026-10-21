import { Effect, Option } from "effect"
import { FileTouch, type FileTouchOp } from "@prioricode/core/file-touch"
import { FSUtil } from "@prioricode/core/fs-util"
import { Project } from "@prioricode/core/project"
import * as Tool from "./tool"

/**
 * Persisted last-writer fingerprints for successful tool writes. Built inside
 * each tool's definition layer (mirroring FileCollision) so execute stays
 * requirement-free. Total by contract: `FileTouch.record` swallows its own
 * failures, so a ledger problem can never fail the tool doing real work; a
 * vanished file records a zero fingerprint, read as "no reliable attribution".
 */
export interface WriteInput {
  readonly ctx: Tool.Context
  readonly projectID: Project.ID
  readonly filepath: string
  readonly op: FileTouchOp
}

export interface Writer {
  readonly recordWrite: (input: WriteInput) => Effect.Effect<void>
}

export const make = Effect.fn("FileTouchRecord.make")(function* () {
  const fs = yield* FSUtil.Service
  const touches = yield* FileTouch.Service

  const recordWrite = Effect.fnUntraced(function* (input: WriteInput) {
    const info =
      input.op === "delete"
        ? undefined
        : yield* fs.stat(input.filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
    const fingerprint =
      info !== undefined && info.type === "File"
        ? {
            mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
            size: Number(info.size),
          }
        : { mtimeMs: 0, size: 0 }
    yield* touches.record({
      projectID: input.projectID,
      path: input.filepath,
      op: input.op,
      sessionID: String(input.ctx.sessionID),
      fingerprint,
      provenance: provenanceOf(input.ctx),
    })
  })

  return { recordWrite } satisfies Writer
})

/** Pointers into the message ledger so peers can inspect the write's stored diff. */
export const provenanceOf = (ctx: Tool.Context): FileTouch.Provenance => {
  const info = ctx.messages.find((item) => item.info.id === ctx.messageID)?.info
  const model =
    info !== undefined && info.role === "assistant" ? `${String(info.providerID)}/${String(info.modelID)}` : undefined
  return {
    messageID: String(ctx.messageID),
    ...(ctx.callID === undefined ? {} : { callID: ctx.callID }),
    ...(model === undefined ? {} : { model }),
  }
}

export * as FileTouchRecord from "./touch-record"
