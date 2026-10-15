import { Component, createMemo, createSignal, type Accessor } from "solid-js"
import { Switch } from "@prioricode/ui/v2/switch-v2"
import { TextInputV2 } from "@prioricode/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

type ServerSync = ReturnType<typeof useServerSync>
type Compaction = NonNullable<ReturnType<ServerSync>["data"]["config"]["compaction"]>

function useCompaction() {
  const serverSync = useServerSync()
  const value = createMemo(() => serverSync().data.config.compaction)
  const commit = (patch: Partial<Compaction>) => {
    void serverSync().updateConfig({ compaction: { ...value(), ...patch } })
  }
  return {
    auto: {
      current: createMemo(() => value()?.auto ?? true),
      set: (next: boolean) => commit({ auto: next }),
    },
    prune: {
      current: createMemo(() => value()?.prune ?? false),
      set: (next: boolean) => commit({ prune: next }),
    },
    threshold: {
      current: createMemo(() => value()?.threshold),
      set: (next: number | undefined) => commit({ threshold: next }),
    },
    reserved: {
      current: createMemo(() => value()?.reserved),
      set: (next: number | undefined) => commit({ reserved: next }),
    },
    preserveRecentTokens: {
      current: createMemo(() => value()?.preserve_recent_tokens),
      set: (next: number | undefined) => commit({ preserve_recent_tokens: next }),
    },
    tailTurns: {
      current: createMemo(() => value()?.tail_turns),
      set: (next: number | undefined) => commit({ tail_turns: next }),
    },
    defaultContext: {
      current: createMemo(() => value()?.default_context),
      set: (next: number | undefined) => commit({ default_context: next }),
    },
  }
}

const NumberSetting: Component<{
  action: string
  title: string
  description: string
  current: Accessor<number | undefined>
  placeholder: string
  min?: number
  max?: number
  onCommit: (value: number | undefined) => void
}> = (props) => {
  const [draft, setDraft] = createSignal<string | undefined>(undefined)
  const display = () => draft() ?? (props.current() !== undefined ? String(props.current()) : "")
  const commit = () => {
    const raw = (draft() ?? "").trim()
    setDraft(undefined)
    if (raw === "") {
      if (props.current() !== undefined) props.onCommit(undefined)
      return
    }
    const parsed = Number(raw)
    if (Number.isNaN(parsed)) return
    let next = Math.trunc(parsed)
    if (props.min !== undefined) next = Math.max(props.min, next)
    if (props.max !== undefined) next = Math.min(props.max, next)
    if (next === props.current()) return
    props.onCommit(next)
  }
  return (
    <SettingsRowV2 title={props.title} description={props.description}>
      <div class="w-full sm:w-[140px]">
        <TextInputV2
          data-action={props.action}
          type="number"
          appearance="base"
          numeric
          value={display()}
          min={props.min}
          max={props.max}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
          }}
          placeholder={props.placeholder}
          aria-label={props.title}
        />
      </div>
    </SettingsRowV2>
  )
}

export const SettingsContextV2: Component = () => {
  const language = useLanguage()
  const compaction = useCompaction()
  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.context.title")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.context.section.compaction")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.context.row.auto.title")}
              description={language.t("settings.context.row.auto.description")}
            >
              <div data-action="settings-compaction-auto">
                <Switch checked={compaction.auto.current()} onChange={(checked) => compaction.auto.set(checked)} />
              </div>
            </SettingsRowV2>
            <NumberSetting
              action="settings-compaction-threshold"
              title={language.t("settings.context.row.threshold.title")}
              description={language.t("settings.context.row.threshold.description")}
              current={compaction.threshold.current}
              placeholder="85"
              min={1}
              max={100}
              onCommit={compaction.threshold.set}
            />
            <SettingsRowV2
              title={language.t("settings.context.row.prune.title")}
              description={language.t("settings.context.row.prune.description")}
            >
              <div data-action="settings-compaction-prune">
                <Switch checked={compaction.prune.current()} onChange={(checked) => compaction.prune.set(checked)} />
              </div>
            </SettingsRowV2>
            <NumberSetting
              action="settings-compaction-reserved"
              title={language.t("settings.context.row.reserved.title")}
              description={language.t("settings.context.row.reserved.description")}
              current={compaction.reserved.current}
              placeholder="20000"
              min={0}
              onCommit={compaction.reserved.set}
            />
            <NumberSetting
              action="settings-compaction-preserve"
              title={language.t("settings.context.row.preserve.title")}
              description={language.t("settings.context.row.preserve.description")}
              current={compaction.preserveRecentTokens.current}
              placeholder="8000"
              min={0}
              onCommit={compaction.preserveRecentTokens.set}
            />
            <NumberSetting
              action="settings-compaction-tail"
              title={language.t("settings.context.row.tail.title")}
              description={language.t("settings.context.row.tail.description")}
              current={compaction.tailTurns.current}
              placeholder="2"
              min={0}
              onCommit={compaction.tailTurns.set}
            />
            <NumberSetting
              action="settings-compaction-default-context"
              title={language.t("settings.context.row.defaultContext.title")}
              description={language.t("settings.context.row.defaultContext.description")}
              current={compaction.defaultContext.current}
              placeholder="256000"
              min={0}
              onCommit={compaction.defaultContext.set}
            />
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}
