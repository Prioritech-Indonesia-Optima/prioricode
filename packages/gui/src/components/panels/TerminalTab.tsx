import { useCallback, useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { useGui } from "../../react/queries"
import { ensureTerminalPty, openPty, type PtyConnection } from "../../core/transport/pty"
import { cn } from "../../lib/cn"

type Status = "idle" | "connecting" | "connected" | "exited"

export function TerminalTab(props: { active: boolean }) {
  const { transport } = useGui()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | undefined>(undefined)
  const openedRef = useRef(false)
  const fitRef = useRef<FitAddon | undefined>(undefined)
  const connRef = useRef<PtyConnection | undefined>(undefined)
  const cursorRef = useRef(0)
  const ptyRef = useRef<string | undefined>(undefined)
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | undefined>(undefined)
  const startedRef = useRef(false)

  const connect = useCallback(async () => {
    const container = containerRef.current
    if (container === null || connRef.current !== undefined) return
    setStatus("connecting")
    setError(undefined)
    try {
      let id = ptyRef.current
      if (id === undefined) {
        id = await ensureTerminalPty(transport)
        if (id === undefined) {
          setError("Cannot create a PTY on this server.")
          setStatus("idle")
          return
        }
        ptyRef.current = id
        cursorRef.current = 0
      }
      if (termRef.current === undefined) termRef.current = new Terminal({ fontSize: 12, scrollback: 8000 })
      const term = termRef.current
      if (!openedRef.current) {
        term.open(container)
        openedRef.current = true
        const fit = new FitAddon()
        term.loadAddon(fit)
        fitRef.current = fit
        term.onData((text) => connRef.current?.write(text))
      }
      fitRef.current?.fit()
      const conn = await openPty({ transport, ptyID: id, cursor: cursorRef.current, onData: (bytes) => term.write(bytes) })
      if (conn === undefined) {
        setError("Terminal connection refused by the host relay.")
        setStatus("idle")
        return
      }
      connRef.current = conn
      conn.resize(term.rows, term.cols)
      void conn.closed.then((info) => {
        cursorRef.current = info.cursor
        if (connRef.current === conn) {
          connRef.current = undefined
          ptyRef.current = undefined
          setStatus("exited")
        }
      })
      setStatus("connected")
    } catch (cause) {
      setError(String(cause))
      setStatus("idle")
    }
  }, [transport])

  useEffect(() => {
    if (props.active && !startedRef.current) {
      startedRef.current = true
      void connect()
    }
  }, [props.active, connect])

  useEffect(() => {
    if (props.active) fitRef.current?.fit()
  }, [props.active, status])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const observer = new ResizeObserver(() => {
      if (!props.active) return
      fitRef.current?.fit()
      const term = termRef.current
      if (term !== undefined) connRef.current?.resize(term.rows, term.cols)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [props.active])

  useEffect(
    () => () => {
      connRef.current?.close()
      termRef.current?.dispose()
    },
    [],
  )

  const kill = async () => {
    connRef.current?.close()
    connRef.current = undefined
    if (ptyRef.current !== undefined) {
      const doomed = ptyRef.current
      ptyRef.current = undefined
      cursorRef.current = 0
      try {
        await transport.client?.ptys.remove({ ptyID: doomed })
      } catch {
        // already gone
      }
    }
    setStatus("idle")
  }

  const retry = () => {
    connRef.current?.close()
    connRef.current = undefined
    void connect()
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", !props.active && "hidden")}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "connected" ? "bg-emerald-500" : status === "connecting" ? "animate-pulse bg-amber-400" : status === "exited" ? "bg-red-500" : "bg-muted-foreground",
          )}
        />
        <span>
          {status === "connected"
            ? "Terminal attached to the server PTY"
            : status === "connecting"
              ? "Connecting…"
              : status === "exited"
                ? "Terminal session ended."
                : "Terminal idle."}
        </span>
        {error !== undefined && <span className="truncate text-destructive">{error}</span>}
        <div className="ms-auto flex gap-1">
          {(status === "exited" || status === "idle") && (
            <button type="button" onClick={() => void connect()} className="rounded border border-border px-2 py-0.5 hover:bg-accent">
              {status === "exited" ? "Reconnect" : "Start"}
            </button>
          )}
          {status === "connected" && (
            <button type="button" onClick={() => void kill()} className="rounded border border-border px-2 py-0.5 hover:bg-accent">
              Kill
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} dir="ltr" className="min-h-0 flex-1 overflow-hidden bg-[var(--xterm-bg,inherit)] p-1" />
    </div>
  )
}
