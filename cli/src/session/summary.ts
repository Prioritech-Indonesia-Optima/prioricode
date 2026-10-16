import { LayerNode } from "@prioricode/core/effect/layer-node"
import { Effect, Layer, Context, Schema } from "effect"
import { SessionV1 } from "@prioricode/core/v1/session"
import { EventBridge } from "@/event-v2-bridge"
import { Snapshot } from "@/snapshot"
import { Session } from "./session"
import { SessionID, MessageID } from "./schema"
import { Config } from "@/config/config"

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

const maxPatchBytes = 1_000_000
const maxPatchTotalBytes = 4_000_000

// Full-context patches for large diffs (generated files, repo-wide renames) can reach tens of MB.
// The durable `message.updated` payload embeds every diff verbatim, so oversized patches are
// dropped (counts stay) to keep the event log, SSE fan-out, and renderer memory bounded.
function capDiffs(diffs: Snapshot.FileDiff[]): Snapshot.FileDiff[] {
  let total = 0
  let touched = false
  const next = diffs.map((item) => {
    const patch = item.patch
    if (!patch) return item
    if (patch.length > maxPatchBytes || total + patch.length > maxPatchTotalBytes) {
      touched = true
      return { ...item, patch: "" }
    }
    total += patch.length
    return item
  })
  return touched ? next : diffs
}

function diffRange(messages: SessionV1.WithParts[]) {
  let from: string | undefined
  let to: string | undefined
  for (const item of messages) {
    if (!from) {
      for (const part of item.parts) {
        if (part.type === "step-start" && part.snapshot) {
          from = part.snapshot
          break
        }
      }
    }
    for (const part of item.parts) {
      if (part.type === "step-finish" && part.snapshot) to = part.snapshot
    }
  }
  return { from, to }
}

export interface Interface {
  readonly summarize: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: SessionV1.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@prioricode/SessionSummary") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshot = yield* Snapshot.Service
    const events = yield* EventBridge.Service
    const config = yield* Config.Service

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: SessionV1.WithParts[] }) {
      const { from, to } = diffRange(input.messages)
      if (from && to) return capDiffs(yield* snapshot.diffFull(from, to))
      return []
    })

    // summarize runs on every assistant step-finish; snapshots are immutable, so the same
    // (from, to) range always yields the same diff. Skip recompute + re-emit when unchanged.
    const summarized = new Map<MessageID, string>()

    const summarize = Effect.fn("SessionSummary.summarize")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      yield* sessions.setSummary({
        sessionID: input.sessionID,
        summary: {
          additions: 0,
          deletions: 0,
          files: 0,
        },
      })
      yield* events.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: [] })
      if ((yield* config.get()).snapshot === false) return
      const all = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      if (!all.length) return

      const messages = all.filter(
        (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
      )
      const target = messages.find((m) => m.info.id === input.messageID)
      if (!target || target.info.role !== "user") return
      const range = diffRange(messages)
      const key = `${range.from ?? ""}:${range.to ?? ""}`
      if (summarized.get(input.messageID) === key) return
      const msgDiffs = yield* computeDiff({ messages })
      if (summarized.size > 1000) {
        const oldest = summarized.keys().next()
        if (!oldest.done) summarized.delete(oldest.value)
      }
      summarized.set(input.messageID, key)
      target.info.summary = { ...target.info.summary, diffs: msgDiffs }
      yield* sessions.updateMessage(target.info)
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      if (!input.messageID) return []
      const message = (yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)).find(
        (item) => item.info.id === input.messageID,
      )
      if (!message || message.info.role !== "user") return []
      const diffs = message.info.summary?.diffs ?? []
      return diffs.map((item) => {
        if (item.file === undefined) return item
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return { ...item, file }
      })
    })

    return Service.of({ summarize, diff, computeDiff })
  }),
)

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
})
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Session.node, Snapshot.node, EventBridge.node, Config.node],
})

export * as SessionSummary from "./summary"
