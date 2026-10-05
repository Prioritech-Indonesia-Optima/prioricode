import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { GuiContext, useGui, useSessionInfo, type GuiBundle } from "./react/queries"
import { bootTransport } from "./app/transport"
import { createChatStore } from "./app/store"
import { EmptyTranscript, MessageList } from "./components/transcript/MessageList"
import { Composer } from "./components/composer/Composer"
import { StatusBanner } from "./components/shell/StatusBanner"
import { AgentPicker, ModelPicker } from "./components/shell/Pickers"
import { ServerDialog } from "./components/shell/ServerDialog"
import { SessionSidebar } from "./components/panels/SessionSidebar"
import { clientErrorMessage } from "./core/transport/errors"

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
})

const EMPTY_SUBSCRIBE = () => () => {}

export function App() {
  const [bundle, setBundle] = useState<GuiBundle | undefined>(undefined)
  const [bootError, setBootError] = useState<string | undefined>(undefined)
  const [bootKey, setBootKey] = useState(0)

  useEffect(() => {
    let active = true
    let created: GuiBundle | undefined
    bootTransport()
      .then((transport) => {
        if (!active) {
          transport.bridge?.dispose()
          return
        }
        created = { transport, store: createChatStore(transport) }
        setBootError(undefined)
        setBundle(created)
      })
      .catch((error: unknown) => {
        if (active) setBootError(String(error))
      })
    return () => {
      active = false
      created?.store.dispose()
      created?.transport.bridge?.dispose()
    }
  }, [bootKey])

  useEffect(() => {
    const bridge = bundle?.transport.bridge
    if (bridge === undefined) return
    return bridge.onConfig((config) => {
      if (config.status === "ready" && bundle?.transport.client === undefined) {
        setBootKey((key) => key + 1)
        return
      }
      bundle?.store.setConfig(config.status, config.detail)
    })
  }, [bundle])

  if (bundle === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>{bootError ?? "Connecting to prioricode…"}</p>
        {bootError !== undefined && (
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setBootKey((key) => key + 1)}>
            Retry
          </button>
        )}
      </div>
    )
  }

  return (
    <GuiContext.Provider value={bundle}>
      <QueryClientProvider client={queryClient}>
        <Shell />
      </QueryClientProvider>
    </GuiContext.Provider>
  )
}

function Shell() {
  const { transport, store } = useGui()
  const [sidebarDrawer, setSidebarDrawer] = useState(false)
  const [serverOpen, setServerOpen] = useState(false)

  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store])
  const snapshot = useSyncExternalStore(
    subscribe,
    () => store.getSnapshot(),
    () => undefined,
  )

  const sessionID = snapshot?.sessionID
  const info = useSessionInfo(sessionID)
  const busy = snapshot?.transcript.busy ?? false

  const previousBusy = useRef(false)
  useEffect(() => {
    if (previousBusy.current && !busy) {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] })
      void queryClient.invalidateQueries({ queryKey: ["session", sessionID] })
    }
    previousBusy.current = busy
  }, [busy, sessionID])

  const actions = useMemo(
    () => ({
      onPermissionReply: (requestID: string, reply: "once" | "always" | "reject") => void store.replyPermission(requestID, reply),
      onQuestionReply: (requestID: string, answers: string[][]) => void store.replyQuestion(requestID, answers),
      onQuestionReject: (requestID: string) => void store.rejectQuestion(requestID),
    }),
    [store],
  )

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest?.("a")
    const href = anchor?.getAttribute("href")
    if (href !== null && href !== undefined && /^https?:|^mailto:/i.test(href)) {
      event.preventDefault()
      event.stopPropagation()
      transport.openExternal(href)
    }
  }

  const compact = async () => {
    if (transport.client === undefined || snapshot === undefined || snapshot.sessionID === undefined) return
    try {
      await transport.client.sessions.compact({ sessionID: snapshot.sessionID })
    } catch (error) {
      store.notify(clientErrorMessage(error))
    }
  }

  if (snapshot === undefined) return null
  const current = { agent: info.data?.agent, model: info.data?.model }

  return (
    <div className="flex h-full min-h-0" onClickCapture={onClickCapture}>
      <div className="hidden h-full md:block">
        <SessionSidebar
          currentID={snapshot.sessionID}
          busy={busy}
          onSelect={(id) => {
            store.selectSession(id)
            setSidebarDrawer(false)
          }}
          onNew={() => store.newSession()}
          onClose={() => setSidebarDrawer(false)}
        />
      </div>
      {sidebarDrawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarDrawer(false)} />
          <div className="absolute inset-y-0 start-0 h-full">
            <SessionSidebar
              currentID={snapshot.sessionID}
              busy={busy}
              onSelect={(id) => {
                store.selectSession(id)
                setSidebarDrawer(false)
              }}
              onNew={() => {
                store.newSession()
                setSidebarDrawer(false)
              }}
              onClose={() => setSidebarDrawer(false)}
            />
          </div>
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col bg-background text-foreground">
        <header className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
          <button
            type="button"
            aria-label="Toggle sessions"
            onClick={() => setSidebarDrawer((open) => !open)}
            className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent md:hidden"
          >
            ☰
          </button>
          <span className="text-sm font-semibold">PrioriCode</span>
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <AgentPicker current={current} />
            <ModelPicker current={current} />
            <button
              type="button"
              onClick={() => void compact()}
              disabled={snapshot.sessionID === undefined || !busy}
              title="Compact context when idle"
              className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-40"
            >
              Compact
            </button>
            <button type="button" onClick={() => setServerOpen(true)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent">
              Server
            </button>
            <button type="button" onClick={store.newSession} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent">
              New
            </button>
          </div>
        </header>
        <StatusBanner
          status={snapshot.status}
          detail={snapshot.statusDetail}
          serverLabel={snapshot.serverLabel}
          note={snapshot.note}
          canRetry={snapshot.status !== "ready"}
          onRetry={() => (transport.kind === "web" ? globalThis.location.reload() : store.retry())}
        />
        {snapshot.restoring ? (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Restoring session…</div>
        ) : snapshot.transcript.blocks.length === 0 ? (
          <EmptyTranscript />
        ) : (
          <MessageList blocks={snapshot.transcript.blocks} {...actions} />
        )}
        <Composer
          sessionID={snapshot.sessionID}
          busy={busy}
          disabled={snapshot.status === "connecting"}
          notice={(message) => store.notify(message)}
          onSend={(submit) => void store.send(submit.text, submit.attachments, { delivery: submit.delivery })}
          onInterrupt={() => void store.interrupt()}
        />
      </main>
      <ServerDialog open={serverOpen} onOpenChange={setServerOpen} />
    </div>
  )
}
