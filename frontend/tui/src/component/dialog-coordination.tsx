import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"

function ago(ms: number) {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}

export function DialogCoordination() {
  const sync = useSync()
  const route = useRoute()
  const { theme } = useTheme()
  const dialog = useDialog()

  const view = createMemo(() =>
    route.data.type === "session" ? sync.data.coordination[route.data.sessionID] : undefined,
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Cross-session coordination
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={view()} fallback={<text fg={theme.textMuted}>No coordination data yet.</text>}>
        {(data) => (
          <>
            <Show when={data().incoming.length > 0} fallback={<text fg={theme.textMuted}>No incoming requests.</text>}>
              <box>
                <text fg={theme.text}>Incoming requests ({data().incoming.length})</text>
                <For each={data().incoming}>
                  {(row) => (
                    <text fg={theme.text} wrapMode="word">
                      <span style={{ fg: theme.textMuted }}>
                        [{row.state}, {ago(row.ageMs)}] from {row.fromSession}:{" "}
                      </span>
                      {row.body}
                    </text>
                  )}
                </For>
              </box>
            </Show>
            <Show when={data().outgoing.length > 0}>
              <box>
                <text fg={theme.text}>Requests you sent ({data().outgoing.length})</text>
                <For each={data().outgoing}>
                  {(row) => (
                    <text fg={theme.text} wrapMode="word">
                      <span style={{ fg: theme.textMuted }}>
                        [{row.state}, {ago(row.ageMs)}] to {row.toSession}:{" "}
                      </span>
                      {row.body}
                    </text>
                  )}
                </For>
              </box>
            </Show>
            <Show when={data().notifies.length > 0}>
              <box>
                <text fg={theme.text}>Waiting on idle ({data().notifies.length})</text>
                <For each={data().notifies}>
                  {(row) => (
                    <text fg={theme.text} wrapMode="word">
                      <span style={{ fg: theme.textMuted }}>{row.target}: </span>
                      {row.note || "(no note)"}
                    </text>
                  )}
                </For>
              </box>
            </Show>
            <Show when={data().escalated > 0}>
              <text fg={theme.error}>{data().escalated} escalated request(s) awaiting attention.</text>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}
