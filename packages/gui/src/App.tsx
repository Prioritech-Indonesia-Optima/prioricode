import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { bootTransport, type AppTransport } from "./app/transport"
import { createChatStore, type ChatStore, type StoreState } from "./app/store"
import { EmptyTranscript, MessageList } from "./components/transcript/MessageList"
import { Composer } from "./components/composer/Composer"
import { SettingsForm } from "./components/shell/SettingsForm"
import { StatusBanner } from "./components/shell/StatusBanner"
import { useUiStore } from "./lib/ui-state"

const EMPTY_SUBSCRIBE = () => () => {}

export function App() {
  const [bundle, setBundle] = useState<{ transport: AppTransport; store: ChatStore } | undefined>(undefined)
  const [bootError, setBootError] = useState<string | undefined>(undefined)
  const [bootKey, setBootKey] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const delivery = useUiStore((state) => state.delivery)

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

  const actions = useMemo(() => {
    if (store === undefined) return undefined
    return {
      onPermissionReply: (requestID: string, reply: "once" | "always" | "reject") => void store.replyPermission(requestID, reply),
      onQuestionReply: (requestID: string, answers: string[][]) => void store.replyQuestion(requestID, answers),
      onQuestionReject: (requestID: string) => void store.rejectQuestion(requestID),
    }
  }, [store])

  if (store === undefined || snapshot === undefined || actions === undefined) {
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
      {snapshot.transcript.blocks.length === 0 ? (
        <EmptyTranscript />
      ) : (
        <MessageList blocks={snapshot.transcript.blocks} {...actions} />
      )}
      <Composer
        sessionID={snapshot.sessionID}
        busy={snapshot.transcript.busy}
        disabled={snapshot.status === "connecting"}
        notice={(message) => store.notify(message)}
        onSend={(submit) => void store.send(submit.text, submit.attachments, { delivery })}
        onInterrupt={() => void store.interrupt()}
      />
    </div>
  )
}

export type { StoreState }
