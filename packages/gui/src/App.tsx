import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { bootTransport, type AppTransport } from "./app/transport"
import { createChatStore, type ChatStore, type StoreState } from "./app/store"
import { BlockList } from "./components/transcript/BlockList"
import { Composer } from "./components/composer/Composer"
import { SettingsForm } from "./components/shell/SettingsForm"
import { StatusBanner } from "./components/shell/StatusBanner"

const EMPTY_SUBSCRIBE = () => () => {}

export function App() {
  const [bundle, setBundle] = useState<{ transport: AppTransport; store: ChatStore } | undefined>(undefined)
  const [bootError, setBootError] = useState<string | undefined>(undefined)
  const [bootKey, setBootKey] = useState(0)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    let active = true
    let created: { transport: AppTransport; store: ChatStore } | undefined
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

  const transport = bundle?.transport
  const store = bundle?.store

  const subscribe = useCallback((listener: () => void) => store?.subscribe(listener) ?? EMPTY_SUBSCRIBE(), [store])
  const snapshot = useSyncExternalStore(
    subscribe,
    () => store?.getSnapshot(),
    () => undefined,
  )

  useEffect(() => {
    const bridge = transport?.bridge
    if (bridge === undefined || store === undefined) return
    return bridge.onConfig((config) => {
      if (config.status === "ready" && transport?.client === undefined) {
        setBootKey((key) => key + 1)
        return
      }
      store.setConfig(config.status, config.detail)
    })
  }, [transport, store])

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight
  })
  const onScroll = () => {
    const el = scrollRef.current
    if (el !== null) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  if (store === undefined || snapshot === undefined) {
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
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">PrioriCode</span>
        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((current) => !current)}
            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
          >
            {transport?.kind === "web" ? "Settings" : "Server"}
          </button>
          <button type="button" onClick={store.newSession} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent">
            New session
          </button>
        </div>
      </header>
      <StatusBanner
        status={snapshot.status}
        detail={snapshot.statusDetail}
        serverLabel={snapshot.serverLabel}
        note={snapshot.note}
        canRetry={snapshot.status !== "ready"}
        onRetry={() => (transport?.kind === "web" ? setBootKey((key) => key + 1) : store.retry())}
      />
      {showSettings && transport?.kind === "web" && (
        <div className="p-3 pb-0">
          <SettingsForm
            onSaved={() => {
              setShowSettings(false)
              setBootKey((key) => key + 1)
            }}
          />
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <MessageStream snapshot={snapshot} store={store} />
      </div>
      <Composer
        busy={snapshot.transcript.busy}
        disabled={snapshot.status === "connecting"}
        onSend={(text) => void store.send(text)}
        onInterrupt={() => void store.interrupt()}
      />
    </div>
  )
}

function MessageStream(props: { snapshot: StoreState; store: ChatStore }) {
  const { snapshot, store } = props
  if (snapshot.transcript.blocks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
        <p className="text-base font-medium text-foreground">PrioriCode</p>
        <p>Ask anything about this workspace.</p>
      </div>
    )
  }
  return (
    <BlockList
      blocks={snapshot.transcript.blocks}
      onPermissionReply={(requestID, reply) => void store.replyPermission(requestID, reply)}
      onQuestionReply={(requestID, answers) => void store.replyQuestion(requestID, answers)}
      onQuestionReject={(requestID) => void store.rejectQuestion(requestID)}
    />
  )
}
