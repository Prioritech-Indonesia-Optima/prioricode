import type { SnapshotFileDiff, VcsFileDiff } from "@prioricode/sdk/v2"
import type { FileDiffInfo } from "@prioricode/client/promise"
import type { Message } from "@prioricode/sdk/v2/client"

type Diff = FileDiffInfo | SnapshotFileDiff | VcsFileDiff

function diff(value: unknown): value is Diff {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  if (!("file" in value) || typeof value.file !== "string") return false
  if (!("patch" in value) || typeof value.patch !== "string") return false
  if (!("additions" in value) || typeof value.additions !== "number") return false
  if (!("deletions" in value) || typeof value.deletions !== "number") return false
  if (!("status" in value) || value.status === undefined) return true
  return value.status === "added" || value.status === "deleted" || value.status === "modified"
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function diffs(value: unknown): Diff[] {
  if (Array.isArray(value) && value.every(diff)) return value
  if (Array.isArray(value)) return value.filter(diff)
  if (diff(value)) return [value]
  if (!object(value)) return []
  return Object.values(value).filter(diff)
}

const maxPatchBytes = 1_000_000
const maxPatchTotalBytes = 4_000_000

// Sessions stored before the server-side cap can carry multi-MB full-context patches.
// Dropping oversized patch text at ingest keeps the store and the diff view inside the
// renderer's memory budget; file rows keep their counts.
function capPatches(items: Diff[]): Diff[] {
  let total = 0
  let touched = false
  const next = items.map((item) => {
    if (!item.patch) return item
    if (item.patch.length > maxPatchBytes || total + item.patch.length > maxPatchTotalBytes) {
      touched = true
      return { ...item, patch: "" } satisfies Diff
    }
    total += item.patch.length
    return item
  })
  return touched ? next : items
}

export function message(value: Message): Message {
  if (value.role !== "user") return value

  const raw = value.summary as unknown
  if (raw === undefined) return value
  if (!object(raw)) return { ...value, summary: undefined }

  const title = typeof raw.title === "string" ? raw.title : undefined
  const body = typeof raw.body === "string" ? raw.body : undefined
  const next = capPatches(diffs(raw.diffs))

  if (title === raw.title && body === raw.body && next === raw.diffs) return value

  return {
    ...value,
    summary: {
      ...(title === undefined ? {} : { title }),
      ...(body === undefined ? {} : { body }),
      diffs: next,
    },
  }
}
