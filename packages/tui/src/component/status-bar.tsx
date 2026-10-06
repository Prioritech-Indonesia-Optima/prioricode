import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import type { PermissionRequest } from "@prioricode/sdk/v2"
import { useDirectory } from "../context/directory"
import { useLocal } from "../context/local"
import { usePermission } from "../context/permission"
import { useSync } from "../context/sync"
import { selectedForeground, useTheme } from "../context/theme"
import { Locale } from "../util/locale"
import { computeUsage } from "../util/context-usage"
import { Pill } from "../ui/pill"

// Persistent per-session status line: where you are (dir:branch), what the
// agent will do (agent + permission mode pills), what needs attention
// (pending permissions, coordination escalations), health (LSP/MCP), and
// context/cost. Replaces the previously orphaned routes/session/footer.tsx.
// Width tiers: <100 drops LSP/MCP + peer notes; <80 drops the directory.
export function StatusBar(props: { sessionID: string; permissions: () => PermissionRequest[] }) {
  const { theme } = useTheme()
  const sync = useSync()
  const local = useLocal()
  const permission = usePermission()
  const directory = useDirectory()
  const dimensions = useTerminalDimensions()

  const compact = createMemo(() => dimensions().width < 100)
  const minimal = createMemo(() => dimensions().width < 80)

  const agent = createMemo(() => local.agent.current())
  const agentPill = createMemo(() => {
    const current = agent()
    if (!current) return undefined
    const bg = local.agent.color(current.name)
    return { label: Locale.titlecase(current.name), bg, fg: selectedForeground(theme, bg) }
  })

  const mode = createMemo(() => permission.mode)
  const modePill = createMemo(() => {
    if (mode() === "ask-first")
      return { label: "ask-first", bg: theme.warning, fg: selectedForeground(theme, theme.warning) }
    if (mode() === "always-allow")
      return { label: "always-allow", bg: theme.success, fg: selectedForeground(theme, theme.success) }
    return undefined
  })

  const pending = createMemo(() => props.permissions().length)

  const coordination = createMemo(() => sync.data.coordination[props.sessionID])
  createEffect(() => {
    void sync.refreshCoordination(props.sessionID)
    const timer = setInterval(() => void sync.refreshCoordination(props.sessionID), 5000)
    onCleanup(() => clearInterval(timer))
  })
  const escalated = createMemo(() => coordination()?.escalated ?? 0)
  const peerNotes = createMemo(() => Object.values(coordination()?.unread ?? {}).reduce((a, b) => a + b, 0))

  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp).length)

  const usage = createMemo(() =>
    computeUsage({
      session: sync.session.get(props.sessionID),
      messages: sync.data.message[props.sessionID] ?? [],
      providers: sync.data.provider,
    }),
  )

  return (
    <box flexDirection="row" justifyContent="space-between" gap={2} flexShrink={0} width="100%">
      <box flexDirection="row" gap={1} minWidth={0} flexShrink={1}>
        <Show when={!minimal()}>
          <text fg={theme.textMuted} wrapMode="none">
            {Locale.truncateMiddle(directory(), Math.min(40, Math.max(12, dimensions().width - 40)))}
          </text>
        </Show>
        <Show when={agentPill()} keyed>
          {(pill) => <Pill label={pill.label} bg={pill.bg} fg={pill.fg} />}
        </Show>
        <Show when={modePill()} keyed>
          {(pill) => <Pill label={pill.label} bg={pill.bg} fg={pill.fg} />}
        </Show>
        <Show when={mode() === "default"}>
          <text fg={theme.textMuted} wrapMode="none">
            ask
          </text>
        </Show>
        <Show when={pending() > 0}>
          <text fg={theme.warning} wrapMode="none">
            △ {pending()} permission{pending() > 1 ? "s" : ""}
          </text>
        </Show>
        <Show when={escalated() > 0}>
          <text fg={theme.error} wrapMode="none">
            ⚠ {escalated()} escalated
          </text>
        </Show>
        <Show when={!compact() && peerNotes() > 0}>
          <text fg={theme.textMuted} wrapMode="none">
            <span style={{ fg: theme.success }}>⊙</span> {peerNotes()} peer notes
          </text>
        </Show>
        <Show when={!compact()}>
          <text fg={theme.textMuted} wrapMode="none">
            <span style={{ fg: lsp() > 0 ? theme.success : theme.textMuted }}>•</span> {lsp()} LSP
          </text>
          <Show when={mcp() > 0}>
            <text fg={theme.textMuted} wrapMode="none">
              <span style={{ fg: mcpError() ? theme.error : theme.success }}>⊙</span> {mcp()} MCP
            </text>
          </Show>
        </Show>
      </box>
      <Show when={usage()} keyed>
        {(item) => (
          <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
            {[item.context, item.cost].filter(Boolean).join(" · ")}
          </text>
        )}
      </Show>
    </box>
  )
}
