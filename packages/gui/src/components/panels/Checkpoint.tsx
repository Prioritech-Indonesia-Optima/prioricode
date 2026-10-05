import { useMemo, useState } from "react"
import { Dialog } from "radix-ui"
import { useGui, useSessionInfo } from "../../react/queries"
import { sessionDiff } from "../../core/transport/extensions"
import { DiffStats, DiffView } from "../transcript/DiffView"
import type { FileDiffInfo } from "../../core/fold/transcript"

interface ReviewFile extends FileDiffInfo {
  source: "checkpoint" | "session"
}

const normalizeSessionDiff = (payload: unknown[] | undefined): FileDiffInfo[] =>
  (payload ?? [])
    .map((value): FileDiffInfo | undefined => {
      if (typeof value === "string") return { path: value }
      if (typeof value !== "object" || value === null) return undefined
      const record = value as Record<string, unknown>
      const path = typeof record.path === "string" ? record.path : typeof record.file === "string" ? record.file : undefined
      if (path === undefined) return undefined
      return {
        path,
        status: record.status === "added" || record.status === "modified" || record.status === "deleted" ? record.status : undefined,
        additions: typeof record.additions === "number" ? record.additions : undefined,
        deletions: typeof record.deletions === "number" ? record.deletions : undefined,
        patch: typeof record.patch === "string" ? record.patch : undefined,
      }
    })
    .filter((file): file is FileDiffInfo => file !== undefined)

export function CheckpointBar() {
  const { store } = useGui()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const info = useSessionInfo(store.getSnapshot().sessionID)
  const revert = info.data?.revert
  if (revert === undefined) return null
  const files = (revert.files ?? []) as FileDiffInfo[]
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="border-t border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-amber-600 dark:text-amber-400">Checkpoint staged</span>
          <span className="text-muted-foreground">workspace reverted to before <bdi dir="ltr" className="font-mono">{revert.messageID}</bdi></span>
          <div className="ms-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setReviewOpen(true)} className="rounded border border-border bg-background px-2 py-0.5 hover:bg-accent">
              Review ({files.length})
            </button>
            <button type="button" disabled={busy} onClick={() => void act(() => store.clearRevert())} className="rounded border border-border bg-background px-2 py-0.5 hover:bg-accent disabled:opacity-50">
              Undo checkpoint
            </button>
            <button type="button" disabled={busy} onClick={() => void act(() => store.commitRevert())} className="rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50">
              Keep
            </button>
          </div>
        </div>
      </div>
      <ReviewPanel open={reviewOpen} onOpenChange={setReviewOpen} checkpointFiles={files} />
    </>
  )
}

export function ReviewPanel(props: { open: boolean; onOpenChange: (open: boolean) => void; checkpointFiles: FileDiffInfo[] }) {
  const { transport, store } = useGui()
  const sessionID = store.getSnapshot().sessionID
  const [extra, setExtra] = useState<FileDiffInfo[] | undefined>()
  const [loading, setLoading] = useState(false)

  const files = useMemo<ReviewFile[]>(() => {
    const seen = new Map<string, ReviewFile>()
    for (const file of props.checkpointFiles) seen.set(file.path, { ...file, source: "checkpoint" })
    for (const file of extra ?? []) if (!seen.has(file.path)) seen.set(file.path, { ...file, source: "session" })
    return [...seen.values()]
  }, [props.checkpointFiles, extra])

  const loadSession = async () => {
    if (transport.client === undefined || sessionID === undefined) return
    setLoading(true)
    try {
      const result = await sessionDiff(
        { baseUrl: transport.baseUrl, fetch: globalThis.fetch, headers: () => transport.authHeaders?.() ?? {} },
        sessionID,
        transport.directory === undefined ? undefined : { location: { directory: transport.directory } },
      )
      setExtra(normalizeSessionDiff(result))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(44rem,95vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center gap-2 border-b border-border p-3">
            <Dialog.Title className="text-sm font-semibold">Changed files</Dialog.Title>
            <span className="text-xs text-muted-foreground">{files.length === 0 ? (loading ? "loading…" : "no changes recorded") : ""}</span>
            {transport.kind === "web" && (
              <button type="button" onClick={() => void loadSession()} className="ms-auto rounded border border-border px-2 py-0.5 text-xs hover:bg-accent">
                Load all session changes
              </button>
            )}
            <Dialog.Close className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent">Close</Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid gap-3">
              {files.map((file) => (
                <div key={file.path} className="rounded border border-border p-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded bg-muted px-1 font-mono">{file.status === "added" ? "A" : file.status === "deleted" ? "D" : file.source === "checkpoint" ? "C" : "M"}</span>
                    <bdi dir="ltr" className="truncate font-mono">{file.path}</bdi>
                    <DiffStats patch={file.patch} additions={file.additions} deletions={file.deletions} />
                    {transport.openFile !== undefined && (
                      <button type="button" onClick={() => transport.openFile?.(file.path)} className="ms-auto rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent">
                        Open
                      </button>
                    )}
                  </div>
                  {file.patch !== undefined && <DiffView patch={file.patch} maxLines={30} className="mt-2" />}
                </div>
              ))}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
