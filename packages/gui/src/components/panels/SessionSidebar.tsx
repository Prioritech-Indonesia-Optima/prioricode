import { useMemo, useState } from "react"
import { cn } from "../../lib/cn"
import { timeAgo, useActiveSessions, useDebounced, useSessions } from "../../react/queries"

export function SessionSidebar(props: {
  currentID: string | undefined
  busy: boolean
  onSelect: (sessionID: string) => void
  onNew: () => void
  onClose: () => void
}) {
  const [search, setSearch] = useState("")
  const debounced = useDebounced(search)
  const sessions = useSessions(debounced)
  const active = useActiveSessions()
  const rows = useMemo(() => sessions.data ?? [], [sessions.data])

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-e border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search sessions…"
          className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={props.onNew}
          title="New session"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
        >
          +
        </button>
        <button
          type="button"
          onClick={props.onClose}
          title="Hide sessions"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-accent md:hidden"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.isPending && rows.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">Loading sessions…</div>
        )}
        {sessions.isError && rows.length === 0 && (
          <div className="p-3 text-xs text-destructive">Cannot list sessions.</div>
        )}
        {rows.length === 0 && !sessions.isPending && (
          <div className="p-3 text-xs text-muted-foreground">No sessions yet.</div>
        )}
        {rows.map((session) => {
          const isActive = active.data?.[session.id] !== undefined || (session.id === props.currentID && props.busy)
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => props.onSelect(session.id)}
              className={cn(
                "block w-full border-b border-border/50 px-3 py-2 text-start text-xs hover:bg-accent",
                session.id === props.currentID && "bg-accent",
              )}
            >
              <div className="flex items-center gap-1.5">
                {isActive && (
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                )}
                <span className="truncate font-medium">{session.title.length > 0 ? session.title : session.id}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 truncate text-[10px] text-muted-foreground">
                <span>{timeAgo(session.time.updated)}</span>
                {session.agent !== undefined && <span>· {session.agent}</span>}
                {session.model !== undefined && (
                  <bdi dir="ltr" className="truncate">
                    · {session.model.providerID}/{session.model.id}
                  </bdi>
                )}
                {session.cost > 0 && <span>· ${session.cost.toFixed(3)}</span>}
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
