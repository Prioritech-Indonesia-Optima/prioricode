import { useMemo, useState } from "react"
import { patchStats, splitPatch } from "../../lib/diff"
import { cn } from "../../lib/cn"

export function DiffView(props: { patch: string; maxLines?: number; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => splitPatch(props.patch), [props.patch])
  const visible = expanded || props.maxLines === undefined ? lines : lines.slice(0, props.maxLines)
  const hidden = lines.length - visible.length
  return (
    <div
      dir="ltr"
      className={cn("overflow-hidden rounded border border-border bg-muted/40 font-mono text-[11px]", props.className)}
    >
      {visible.map((line, index) => (
        <div
          key={index}
          className={cn(
            "whitespace-pre-wrap px-2 py-0.5",
            line.kind === "add" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
            line.kind === "remove" && "bg-red-500/15 text-red-600 dark:text-red-400",
            line.kind === "meta" && "text-muted-foreground",
          )}
        >
          {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : line.kind === "meta" ? "" : " "}
          {line.text}
        </div>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className="w-full border-t border-border px-2 py-1 text-start text-muted-foreground hover:bg-accent"
          onClick={() => setExpanded(true)}
        >
          Show {hidden} more lines
        </button>
      )}
    </div>
  )
}

export function DiffStats({ patch, additions, deletions }: { patch?: string; additions?: number; deletions?: number }) {
  const stats = useMemo(
    () =>
      additions === undefined || deletions === undefined
        ? patch !== undefined
          ? patchStats(patch)
          : undefined
        : { additions, deletions },
    [patch, additions, deletions],
  )
  if (stats === undefined || (stats.additions === 0 && stats.deletions === 0)) return null
  return (
    <span className="font-mono text-[10px]">
      <span className="text-emerald-500">+{stats.additions}</span>{" "}
      <span className="text-red-500">−{stats.deletions}</span>
    </span>
  )
}
