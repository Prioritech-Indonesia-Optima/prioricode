import { createMemo } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogThemeList } from "./dialog-theme-list"
import { DialogModelSettings } from "./dialog-model-settings"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useKV } from "../context/kv"
import { useLocal } from "../context/local"
import { usePermission } from "../context/permission"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { useTuiConfig, useTuiConfigWrite, type TuiConfig } from "../config"
import * as Model from "../util/model"

const CURSOR_STYLES = ["block", "underline", "line", "default"] as const
const DIFF_STYLES = ["auto", "stacked"] as const

function bool(value: boolean | undefined, fallback: boolean) {
  return (value ?? fallback) ? "on" : "off"
}

function number(value: number | undefined, fallback: string) {
  return value === undefined ? fallback : String(value)
}

function nextIn<T>(list: readonly T[], current: T) {
  const index = list.indexOf(current)
  return list[(index + 1) % list.length]
}

export function DialogSettings() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const kv = useKV()
  const local = useLocal()
  const permission = usePermission()
  const theme = useTheme()
  const toast = useToast()
  const tuiConfig = useTuiConfig()
  const tuiConfigWrite = useTuiConfigWrite()

  const compaction = createMemo(() => sync.data.config.compaction)

  function reopen() {
    dialog.replace(() => <DialogSettings />)
  }

  async function saveServerConfig(patch: Record<string, unknown>, label: string) {
    try {
      await sdk.client.global.config.update({ config: patch }, { throwOnError: true })
      await sync.bootstrap({ fatal: false }).catch(() => undefined)
      toast.show({ message: `Saved ${label}`, variant: "success" })
    } catch (err) {
      toast.error(err)
    }
  }

  async function saveTuiConfig(patch: Partial<TuiConfig.Info>, label: string, restart = false) {
    try {
      await tuiConfigWrite.update(patch)
      if (restart) {
        toast.show({ message: `Saved ${label} — restart to apply`, variant: "info", duration: 4000 })
      }
    } catch (err) {
      toast.error(err)
    }
  }

  function saveCompaction(next: Partial<NonNullable<ReturnType<typeof compaction>>>, label: string) {
    return saveServerConfig({ compaction: { ...compaction(), ...next } }, label)
  }

  function askNumber(opts: {
    label: string
    hint: string
    current?: number
    min?: number
    max?: number
    allowDecimal?: boolean
    restart?: boolean
    apply: (value: number) => Promise<void> | void
  }) {
    dialog.replace(() => (
      <DialogPrompt
        title={opts.label}
        placeholder={opts.hint}
        value={opts.current === undefined ? "" : String(opts.current)}
        onConfirm={(raw) => {
          const parsed = Number(raw.trim())
          if (!Number.isFinite(parsed)) {
            toast.show({ message: "Enter a number", variant: "error" })
            return
          }
          if (!opts.allowDecimal && !Number.isInteger(parsed)) {
            toast.show({ message: "Enter a whole number", variant: "error" })
            return
          }
          if (opts.min !== undefined && parsed < opts.min) {
            toast.show({ message: `Must be at least ${opts.min}`, variant: "error" })
            return
          }
          if (opts.max !== undefined && parsed > opts.max) {
            toast.show({ message: `Must be at most ${opts.max}`, variant: "error" })
            return
          }
          void Promise.resolve(opts.apply(parsed)).then(reopen)
        }}
        onCancel={reopen}
      />
    ))
  }

  const currentModel = createMemo(() => local.model.current())
  const currentModelName = createMemo(() => {
    const model = currentModel()
    if (!model) return undefined
    return Model.name(sync.data.provider, model.providerID, model.modelID)
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const c = compaction()
    const attention = tuiConfig.attention
    return [
      // ------------------------------------------------------------- Model & Context
      {
        title: "Model & limits…",
        value: "model.settings",
        category: "Model & Context",
        description: "Default model, context window, output limit, and compaction threshold for the current model",
        footer: currentModelName(),
        onSelect: () => {
          const model = currentModel()
          if (!model) {
            toast.show({ message: "Connect a provider to edit model settings", variant: "warning" })
            return
          }
          dialog.replace(() => <DialogModelSettings providerID={model.providerID} modelID={model.modelID} />)
        },
      },
      {
        title: "Auto-compaction",
        value: "compaction.auto",
        category: "Model & Context",
        description: "Automatically summarize when the context window fills up",
        footer: bool(c?.auto, true),
        onSelect: () => void saveCompaction({ auto: !(c?.auto ?? true) }, "auto-compaction"),
      },
      {
        title: "Compaction threshold",
        value: "compaction.threshold",
        category: "Model & Context",
        description: "Percent (1-100) of the context window at which compaction triggers",
        footer: c?.threshold === undefined ? "not set" : `${c.threshold}%`,
        onSelect: () =>
          askNumber({
            label: "Compaction threshold (%)",
            hint: "85",
            current: c?.threshold,
            min: 1,
            max: 100,
            apply: (v) => saveCompaction({ threshold: v }, "compaction threshold"),
          }),
      },
      {
        title: "Prune tool output",
        value: "compaction.prune",
        category: "Model & Context",
        description: "Prune old tool output to reclaim context before compacting",
        footer: bool(c?.prune, false),
        onSelect: () => void saveCompaction({ prune: !(c?.prune ?? false) }, "tool output pruning"),
      },
      {
        title: "Compaction buffer",
        value: "compaction.reserved",
        category: "Model & Context",
        description: "Tokens left out of the window to avoid overflow during compaction (ignored when threshold is set)",
        footer: number(c?.reserved, "not set"),
        onSelect: () =>
          askNumber({
            label: "Compaction buffer (tokens)",
            hint: "20000",
            current: c?.reserved,
            min: 0,
            apply: (v) => saveCompaction({ reserved: v }, "compaction buffer"),
          }),
      },
      {
        title: "Preserve recent tokens",
        value: "compaction.preserve_recent_tokens",
        category: "Model & Context",
        description: "Maximum tokens from recent turns kept verbatim after compaction",
        footer: number(c?.preserve_recent_tokens, "not set"),
        onSelect: () =>
          askNumber({
            label: "Preserve recent tokens",
            hint: "8000",
            current: c?.preserve_recent_tokens,
            min: 0,
            apply: (v) => saveCompaction({ preserve_recent_tokens: v }, "preserved tokens"),
          }),
      },
      {
        title: "Tail turns kept",
        value: "compaction.tail_turns",
        category: "Model & Context",
        description: "Recent user turns (with their replies) kept verbatim during compaction",
        footer: number(c?.tail_turns, "not set"),
        onSelect: () =>
          askNumber({
            label: "Tail turns kept",
            hint: "2",
            current: c?.tail_turns,
            min: 0,
            apply: (v) => saveCompaction({ tail_turns: v }, "tail turns"),
          }),
      },
      {
        title: "Fallback context window",
        value: "compaction.default_context",
        category: "Model & Context",
        description: "Context size for models without a declared limit (0 disables compaction for them)",
        footer: number(c?.default_context, "128000"),
        onSelect: () =>
          askNumber({
            label: "Fallback context window (tokens)",
            hint: "128000",
            current: c?.default_context,
            min: 0,
            apply: (v) => saveCompaction({ default_context: v }, "fallback context window"),
          }),
      },

      // ------------------------------------------------------------------- Appearance
      {
        title: "Theme…",
        value: "appearance.theme",
        category: "Appearance",
        description: "Preview and pick a color theme",
        footer: theme.selected,
        onSelect: () => dialog.replace(() => <DialogThemeList />),
      },
      {
        title: theme.mode() === "dark" ? "Switch to light mode" : "Switch to dark mode",
        value: "appearance.mode",
        category: "Appearance",
        description: "Base color mode for themes and syntax highlighting",
        footer: theme.mode(),
        onSelect: () => {
          theme.setMode(theme.mode() === "dark" ? "light" : "dark")
        },
      },
      {
        title: theme.locked() ? "Unlock color mode" : "Lock color mode",
        value: "appearance.mode.lock",
        category: "Appearance",
        description: "Keep the current mode instead of following the terminal",
        footer: theme.locked() ? "locked" : "unlocked",
        onSelect: () => {
          if (theme.locked()) theme.unlock()
          else theme.lock()
        },
      },
      {
        title: "Diff style",
        value: "appearance.diff_style",
        category: "Appearance",
        description: "'auto' adapts to terminal width, 'stacked' is always single column",
        footer: tuiConfig.diff_style ?? "auto",
        onSelect: () => {
          const next = nextIn(DIFF_STYLES, tuiConfig.diff_style ?? "auto")
          void saveTuiConfig({ diff_style: next }, "diff style")
        },
      },
      {
        title: "Diff word wrapping",
        value: "appearance.diff_wrap",
        category: "Appearance",
        description: "Wrap long lines in diffs at word boundaries",
        footer: kv.get("diff_wrap_mode", "word") === "word" ? "on" : "off",
        onSelect: () =>
          kv.set("diff_wrap_mode", kv.get("diff_wrap_mode", "word") === "word" ? "none" : "word"),
      },
      {
        title: "Cursor style",
        value: "appearance.cursor_style",
        category: "Appearance",
        description: "Terminal cursor shape",
        footer: tuiConfig.cursor?.style ?? "block",
        onSelect: () => {
          const next = nextIn(CURSOR_STYLES, tuiConfig.cursor?.style ?? "block")
          void saveTuiConfig({ cursor: { style: next } }, "cursor style")
        },
      },
      {
        title: "Cursor blinking",
        value: "appearance.cursor_blinking",
        category: "Appearance",
        description: "Whether the cursor blinks (ignored for 'default' style)",
        footer: bool(tuiConfig.cursor?.blinking, true),
        onSelect: () => void saveTuiConfig({ cursor: { blinking: !(tuiConfig.cursor?.blinking ?? true) } }, "cursor blinking"),
      },
      {
        title: "Animations",
        value: "appearance.animations",
        category: "Appearance",
        description: "Spinner and animation effects",
        footer: bool(kv.get("animations_enabled", true), true),
        onSelect: () => kv.set("animations_enabled", !kv.get("animations_enabled", true)),
      },
      {
        title: "Terminal title",
        value: "appearance.terminal_title",
        category: "Appearance",
        description: "Show session title in the terminal window tab",
        footer: bool(terminalTitleValue(), true),
        onSelect: () => kv.set("terminal_title_enabled", !terminalTitleValue()),
      },

      // ------------------------------------------------------------------ Interaction
      {
        title: "Mouse capture",
        value: "interaction.mouse",
        category: "Interaction",
        description: "Use the mouse for clicking, selection, and scrolling",
        footer: bool(tuiConfig.mouse, true),
        onSelect: () => void saveTuiConfig({ mouse: !tuiConfig.mouse }, "mouse capture"),
      },
      {
        title: "Scroll acceleration",
        value: "interaction.scroll_acceleration",
        category: "Interaction",
        description: "macOS-style accelerated scrolling (overrides scroll speed)",
        footer: bool(tuiConfig.scroll_acceleration?.enabled, false),
        onSelect: () =>
          void saveTuiConfig({ scroll_acceleration: { enabled: !(tuiConfig.scroll_acceleration?.enabled ?? false) } }, "scroll acceleration"),
      },
      {
        title: "Scroll speed",
        value: "interaction.scroll_speed",
        category: "Interaction",
        description: "Lines scrolled per notch (used when acceleration is off)",
        footer: number(tuiConfig.scroll_speed, "3"),
        onSelect: () =>
          askNumber({
            label: "Scroll speed",
            hint: "3",
            current: tuiConfig.scroll_speed,
            min: 0.001,
            allowDecimal: true,
            apply: (v) => saveTuiConfig({ scroll_speed: v }, "scroll speed"),
          }),
      },
      {
        title: "Prompt max height",
        value: "interaction.prompt_height",
        category: "Interaction",
        description: "Maximum height of the prompt textarea in lines",
        footer: number(tuiConfig.prompt?.max_height, "auto (/3 of terminal)"),
        onSelect: () =>
          askNumber({
            label: "Prompt max height (lines)",
            hint: "12",
            current: tuiConfig.prompt?.max_height,
            min: 1,
            apply: (v) => saveTuiConfig({ prompt: { max_height: v } }, "prompt height"),
          }),
      },
      {
        title: "Prompt max width",
        value: "interaction.prompt_width",
        category: "Interaction",
        description: "Width cap for the home prompt: a token count, or 'auto' to scale with the terminal",
        footer: tuiConfig.prompt?.max_width === undefined ? "default (75)" : String(tuiConfig.prompt.max_width),
        onSelect: () => {
          dialog.replace(() => (
            <DialogPrompt
              title="Prompt max width"
              placeholder="75 or auto"
              value={tuiConfig.prompt?.max_width === undefined ? "" : String(tuiConfig.prompt.max_width)}
              onConfirm={(raw) => {
                const text = raw.trim()
                if (text === "auto") {
                  void saveTuiConfig({ prompt: { max_width: "auto" } }, "prompt width").then(reopen)
                  return
                }
                const parsed = Number(text)
                if (!Number.isInteger(parsed) || parsed <= 0) {
                  toast.show({ message: "Enter a positive whole number, or 'auto'", variant: "error" })
                  return
                }
                void saveTuiConfig({ prompt: { max_width: parsed } }, "prompt width").then(reopen)
              }}
              onCancel={reopen}
            />
          ))
        },
      },
      {
        title: "Leader timeout",
        value: "interaction.leader_timeout",
        category: "Interaction",
        description: "Milliseconds to wait for the second leader key stroke (applies after restart)",
        footer: `${tuiConfig.leader_timeout}ms`,
        onSelect: () =>
          askNumber({
            label: "Leader timeout (ms)",
            hint: "2000",
            current: tuiConfig.leader_timeout,
            min: 1,
            restart: true,
            apply: (v) => saveTuiConfig({ leader_timeout: v }, "leader timeout", true),
          }),
      },
      {
        title: "File context",
        value: "interaction.file_context",
        category: "Interaction",
        description: "Automatically include current editor file context in prompts",
        footer: bool(kv.get("file_context_enabled", true), true),
        onSelect: () => kv.set("file_context_enabled", !kv.get("file_context_enabled", true)),
      },
      {
        title: "Paste summary",
        value: "interaction.paste_summary",
        category: "Interaction",
        description: "Summarize large pasted text instead of inserting it verbatim",
        footer: bool(kv.get("paste_summary_enabled", true), true),
        onSelect: () => kv.set("paste_summary_enabled", !kv.get("paste_summary_enabled", true)),
      },
      {
        title: "Session directory filter",
        value: "interaction.session_filter",
        category: "Interaction",
        description: "Limit session lists to the current project directory",
        footer: bool(kv.get("session_directory_filter_enabled", true), true),
        onSelect: () => {
          kv.set("session_directory_filter_enabled", !kv.get("session_directory_filter_enabled", true))
          void sync.session.refresh()
        },
      },

      // ---------------------------------------------------------------- Notifications
      {
        title: "Attention notifications",
        value: "attention.enabled",
        category: "Notifications",
        description: "Overall switch for terminal attention alerts",
        footer: bool(attention.enabled, false),
        onSelect: () => void saveTuiConfig({ attention: { enabled: !(attention.enabled ?? false) } }, "attention notifications"),
      },
      {
        title: "Desktop notifications",
        value: "attention.notifications",
        category: "Notifications",
        description: "Send OS notifications when a response needs you",
        footer: bool(attention.notifications, true),
        onSelect: () =>
          void saveTuiConfig({ attention: { notifications: !(attention.notifications ?? true) } }, "desktop notifications"),
      },
      {
        title: "Sounds",
        value: "attention.sound",
        category: "Notifications",
        description: "Play sounds on questions, permissions, and completions",
        footer: bool(attention.sound, true),
        onSelect: () => void saveTuiConfig({ attention: { sound: !(attention.sound ?? true) } }, "sounds"),
      },
      {
        title: "Sound volume",
        value: "attention.volume",
        category: "Notifications",
        description: "Volume for attention sounds (0-100)",
        footer: `${Math.round(attention.volume * 100)}%`,
        onSelect: () =>
          askNumber({
            label: "Sound volume (%)",
            hint: "40",
            current: Math.round(attention.volume * 100),
            min: 0,
            max: 100,
            apply: (v) => saveTuiConfig({ attention: { volume: v / 100 } }, "sound volume"),
          }),
      },

      // -------------------------------------------------------------------- Behavior
      {
        title: "Auto-approve permissions",
        value: "behavior.auto_approve",
        category: "Behavior",
        description: "Automatically approve tool permissions (yolo mode, remembered across restarts)",
        footer: permission.mode === "auto" ? "on" : "off",
        onSelect: () => permission.toggle(),
      },
    ]
  })

  function terminalTitleValue() {
    return kv.get("terminal_title_enabled", true)
  }

  return (
    <DialogSelect
      title="Settings"
      options={options()}
    />
  )
}
