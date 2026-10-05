import type { StoreStatus } from "../../app/store"
import { cn } from "../../lib/cn"

const STATUS_DOT: Record<StoreStatus, string> = {
  ready: "bg-emerald-500",
  connecting: "bg-amber-400",
  offline: "bg-red-500",
  "auth-mismatch": "bg-red-500",
  "no-cli": "bg-red-500",
  error: "bg-red-500",
}

const STATUS_LABEL: Record<StoreStatus, string> = {
  ready: "Connected",
  connecting: "Connecting…",
  offline: "Server offline",
  "auth-mismatch": "Password mismatch",
  "no-cli": "prioricode not found",
  error: "Error",
}

export function StatusBanner(props: {
  status: StoreStatus
  detail?: string
  serverLabel?: string
  note?: string
  canRetry: boolean
  onRetry: () => void
}) {
  const degraded = props.status !== "ready"
  return (
    <div className="px-3 pt-2">
      <div className="flex items-center gap-2 text-xs">
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[props.status])} aria-hidden />
        <span className={cn("truncate", degraded ? "text-destructive" : "text-muted-foreground")}>
          {STATUS_LABEL[props.status]}
          {props.serverLabel !== undefined ? ` · ${props.serverLabel}` : ""}
          {degraded && props.detail !== undefined ? ` — ${props.detail}` : ""}
        </span>
        {props.canRetry && (
          <button
            type="button"
            onClick={props.onRetry}
            className="ms-auto rounded border border-border px-2 py-0.5 hover:bg-accent"
          >
            Retry
          </button>
        )}
      </div>
      {props.note !== undefined && (
        <div role="alert" className="mt-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {props.note}
        </div>
      )}
    </div>
  )
}
