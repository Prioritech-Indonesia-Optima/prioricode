export * as ToolTouchRecord from "./touch-record"

import { Effect, Option } from "effect"
import { FileTouch, relativePath as relativeOf, type FileTouchOp } from "../file-touch"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { Project } from "../project"
import { SessionStore } from "../session/store"
import type { Context } from "./tool"

/**
 * Services a tool layer captures at construction for touch recording, so the
 * executor stays requirement-free (core tool AGENTS: leaves capture their
 * services at layer construction).
 */
export interface Recorder {
  readonly touches: FileTouch.Interface
  readonly fs: FSUtil.Interface
  readonly store: SessionStore.Interface
  readonly projectID: Project.ID
  /** This checkout's root — repo-relative paths are computed against it. */
  readonly worktreeRoot: string
}

/**
 * Persist durable last-writer fingerprints for the files one tool write just
 * committed. Total by contract: every lookup failure degrades to missing
 * provenance, and `FileTouch.record` swallows its own failures — attribution
 * must never fail the mutation it documents.
 */
export const recordWrites = Effect.fn("ToolTouchRecord.recordWrites")(function* (
  rec: Recorder,
  context: Context,
  writes: ReadonlyArray<{ readonly path: string; readonly op: FileTouchOp }>,
) {
  if (writes.length === 0) return
  const found = yield* rec.store.message(context.assistantMessageID).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const model =
    found !== undefined && found.message.type === "assistant"
      ? `${String(found.message.model.providerID)}/${String(found.message.model.id)}`
      : undefined
  for (const write of writes) {
    const info =
      write.op === "delete"
        ? undefined
        : yield* rec.fs.stat(write.path).pipe(Effect.catch(() => Effect.succeed(undefined)))
    const fingerprint =
      info !== undefined && info.type === "File"
        ? {
            mtimeMs: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
            size: Number(info.size),
          }
        : { mtimeMs: 0, size: 0 }
    yield* rec.touches.record({
      projectID: rec.projectID,
      path: write.path,
      relativePath: relativeOf(rec.worktreeRoot, write.path),
      op: write.op,
      sessionID: String(context.sessionID),
      fingerprint,
      provenance: {
        messageID: String(context.assistantMessageID),
        callID: context.toolCallID,
        ...(model === undefined ? {} : { model }),
      },
    })
  }
})

/** Captures the recorder from the surrounding layer context. */
export const makeRecorder = Effect.fn("ToolTouchRecord.makeRecorder")(function* () {
  const location = yield* Location.Service
  return {
    touches: yield* FileTouch.Service,
    fs: yield* FSUtil.Service,
    store: yield* SessionStore.Service,
    projectID: location.project.id,
    worktreeRoot: String(location.project.directory),
  } satisfies Recorder
})
