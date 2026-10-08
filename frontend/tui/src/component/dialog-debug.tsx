import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, createSignal, For } from "solid-js"
import { InstallationChannel, InstallationVersion } from "@prioricode/core/installation/version"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useRoute } from "../context/route"
import { useLocal } from "../context/local"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { useBindings } from "../keymap"
import { describeOS, describeTerminal } from "../util/system"
import { probeClipboardTools } from "../clipboard"
import { clipboardSignals, resolveScenario } from "../clipboard-scenario"
import { terminalClipboardLastAttempt } from "../clipboard-terminal"
import { useKV } from "../context/kv"

export function DialogDebug() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const route = useRoute()
  const local = useLocal()
  const clipboard = useClipboard()
  const kv = useKV()
  const toast = useToast()
  const [copied, setCopied] = createSignal(false)

  dialog.setSize("large")

  const signals = clipboardSignals()
  const [tools] = createResource(probeClipboardTools)
  const flag = (present?: string | boolean) => (present ? "present" : "absent")

  const entries = createMemo(() => {
    const model = local.model.current()
    return [
      { label: "Version", value: `${InstallationVersion} (${InstallationChannel})` },
      { label: "Date", value: new Date().toISOString() },
      { label: "OS", value: describeOS() },
      { label: "Terminal", value: describeTerminal() },
      { label: "Session ID", value: route.data.type === "session" ? route.data.sessionID : "n/a" },
      { label: "Model", value: model ? `${model.providerID}/${model.modelID}` : "n/a" },
      { label: "Clipboard", value: resolveScenario(signals) },
      { label: "Remote", value: flag(signals.remote) },
      { label: "WSL", value: flag(signals.wsl) },
      { label: "SSH env", value: flag(process.env.SSH_CONNECTION || process.env.SSH_TTY) },
      { label: "Win32 FFI", value: tools.loading ? "probing" : flag(tools()?.win32Ffi) },
      {
        label: "Term clip",
        value: [
          `enabled=${kv.get("terminal_clipboard_enabled", true) ? "y" : "n"}`,
          `terminal=${signals.terminal ?? "unknown"}`,
          (() => {
            const attempt = terminalClipboardLastAttempt()
            return attempt ? `last=${attempt.outcome}${attempt.mime ? `(${attempt.mime})` : ""}` : "last=none"
          })(),
        ].join(" "),
      },
      {
        label: "Clip tools",
        value: tools.loading
          ? "probing"
          : Object.entries(tools() ?? {})
              .filter(([name]) => name !== "wsl" && name !== "win32Ffi")
              .map(([name, present]) => `${name}=${present ? "y" : "n"}`)
              .join(" ") || "none",
      },
    ]
  })

  const copy = () => {
    const text = entries()
      .map((entry) => `${entry.label}: ${entry.value}`)
      .join("\n")
    void clipboard
      .write?.(text)
      .then(() => {
        setCopied(true)
        toast.show({ message: "Debug info copied to clipboard", variant: "info" })
      })
      .catch(toast.error)
  }

  useBindings(() => ({
    bindings: [{ key: "return", desc: "Copy debug info", group: "Dialog", cmd: copy }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Debug
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      {/* No click-to-copy here: releasing a mouse selection must trigger the
          global copy-on-select so users can copy a single value, e.g. the session id. */}
      <box>
        <For each={entries()}>
          {(entry) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={theme.textMuted}>
                {entry.label.padEnd(10)}
              </text>
              <text fg={theme.text} wrapMode="word">
                {entry.value}
              </text>
            </box>
          )}
        </For>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>Share this when reporting an issue.</text>
        <text onMouseUp={copy}>
          <span style={{ fg: copied() ? theme.success : theme.text }}>
            <b>{copied() ? "✓ copied" : "copy"}</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>enter</span>
        </text>
      </box>
    </box>
  )
}
