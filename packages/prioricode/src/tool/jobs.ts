import { Effect, Schema } from "effect"
import { open } from "node:fs/promises"
import * as Tool from "./tool"
import DESCRIPTION from "./jobs.txt"
import { BackgroundJob } from "@/background/job"
import { PositiveInt } from "@prioricode/core/schema"
import * as Truncate from "./truncate"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "output", "wait", "kill"]).annotate({
    description:
      'What to do: "list" all jobs, read one job\'s "output", "wait" for it to finish, or "kill" a running shell job',
  }),
  id: Schema.optional(Schema.String).annotate({
    description:
      'Job id (from the bash tool output when background: true, or from "list"). Required for output/wait/kill',
  }),
  cursor: Schema.optional(PositiveInt).annotate({
    description:
      'Byte offset returned by the previous "output"/"wait" call for this job; only output after this offset is sent. Omit to read from the start',
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description:
      'Milliseconds to block for action "wait" (default 5000, capped at 600000). Returns early with status "running" if the job is still going',
  }),
})

type Metadata = {
  jobs?: { id: string; type: string; status: string; title?: string }[]
  jobId?: string
  jobStatus?: string
  jobCursor?: number
  [key: string]: unknown
}

const WAIT_DEFAULT_MS = 5_000
const WAIT_MAX_MS = 600_000
const LIST_TITLE_LENGTH = 120

function describe(info: BackgroundJob.Info) {
  const title = info.title ? ` — ${info.title.slice(0, LIST_TITLE_LENGTH)}` : ""
  return `- ${info.id} [${info.type}] ${info.status}${title}`
}

function outputPathOf(info: BackgroundJob.Info) {
  const value = info.metadata?.outputPath
  return typeof value === "string" ? value : undefined
}

const readRange = Effect.fn("JobsTool.readRange")(function* (file: string, offset: number, maxBytes: number) {
  return yield* Effect.tryPromise({
    try: async () => {
      const handle = await open(file, "r")
      try {
        const { size } = await handle.stat()
        if (offset >= size) return { text: "", cursor: size, more: false }
        const length = Math.min(size - offset, maxBytes)
        const buffer = Buffer.alloc(length)
        await handle.read(buffer, 0, length, offset)
        // start at a character boundary: leading continuation bytes belong to a
        // character whose head was already delivered by the previous read
        let start = 0
        while (start < length && (buffer[start]! & 0xc0) === 0x80) start++
        // never cut a multi-byte character at the tail: back the cursor off so
        // the incomplete sequence is re-read next time
        let end = length
        let head = end - 1
        while (head > start && (buffer[head]! & 0xc0) === 0x80) head--
        if (head >= start) {
          const lead = buffer[head]!
          const need = lead < 0x80 ? 1 : lead < 0xc0 ? 0 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
          if (head + need > length) end = head
        }
        return {
          text: buffer.subarray(start, end).toString("utf8"),
          cursor: offset + end,
          more: offset + end < size,
        }
      } finally {
        await handle.close()
      }
    },
    catch: (error) => error,
  }).pipe(Effect.catch(() => Effect.succeed({ text: "", cursor: offset, more: false })))
})

export const JobsTool = Tool.define<typeof Parameters, Metadata, BackgroundJob.Service | Truncate.Service>(
  "jobs",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const trunc = yield* Truncate.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "list") {
            const jobs = yield* background.list()
            return {
              title: `${jobs.length} background job${jobs.length === 1 ? "" : "s"}`,
              metadata: {
                jobs: jobs.map((item) => ({
                  id: item.id,
                  type: item.type,
                  status: item.status,
                  title: item.title,
                })),
              },
              output: jobs.length
                ? jobs.map(describe).join("\n")
                : "No background jobs. Start one with the bash tool (background: true).",
            }
          }

          if (!params.id) {
            return yield* Effect.fail(
              new Error(`jobs requires an "id" for action "${params.action}" (use action "list" to discover jobs)`),
            )
          }

          if (params.action === "kill") {
            const cancelled = yield* background.cancel(params.id)
            if (!cancelled) {
              return yield* Effect.fail(new Error(`Unknown background job: ${params.id}`))
            }
            if (cancelled.status !== "running" && cancelled.status !== "cancelled") {
              return yield* Effect.fail(
                new Error(`Job ${params.id} already finished (status: ${cancelled.status}); nothing to kill`),
              )
            }
            return {
              title: `Killed ${params.id}`,
              metadata: { jobId: params.id, jobStatus: cancelled.status },
              output: `Killed background job ${params.id} (${cancelled.title ?? "no title"}). Status: ${cancelled.status}`,
            }
          }

          const limits = yield* trunc.limits()
          const waited =
            params.action === "wait"
              ? yield* background.wait({
                  id: params.id,
                  timeout: Math.min(params.timeout ?? WAIT_DEFAULT_MS, WAIT_MAX_MS),
                })
              : { info: yield* background.get(params.id), timedOut: false }
          const info = waited.info
          if (!info) return yield* Effect.fail(new Error(`Unknown background job: ${params.id}`))

          const file = outputPathOf(info)
          const chunk = file ? yield* readRange(file, params.cursor ?? 0, limits.maxBytes) : undefined
          const sections: string[] = [
            `Job ${info.id} [${info.type}] status: ${info.status}${info.error ? ` (${info.error})` : ""}`,
          ]
          if (info.status !== "running") {
            // the result summary belongs to first-time readers only; a cursor
            // read is a pure delta and must never replay it
            const replay = file !== undefined && params.cursor !== undefined
            if (!replay && info.output) sections.push(info.output)
          }
          if (chunk !== undefined) {
            if (chunk.text) sections.push(chunk.text.endsWith("\n") ? chunk.text.slice(0, -1) : chunk.text)
            if (chunk.more)
              sections.push(`(output truncated at ${limits.maxBytes} bytes — call again with cursor=${chunk.cursor})`)
          } else if (info.status === "running" && info.type !== "bash") {
            sections.push("This job type has no incremental output; wait for completion or use list.")
          }

          return {
            title: `${params.action} ${info.id}`,
            metadata: { jobId: info.id, jobStatus: info.status, ...(chunk ? { jobCursor: chunk.cursor } : {}) },
            output: [
              sections.join("\n"),
              info.status === "running"
                ? waited.timedOut
                  ? `\nStill running after the wait timeout${chunk && chunk.cursor !== (params.cursor ?? 0) ? `; ${chunk.cursor} bytes read so far` : ""}. Do not poll in a loop — results are announced automatically; call "wait" again with a larger timeout only if you truly cannot continue without it.`
                  : ""
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
