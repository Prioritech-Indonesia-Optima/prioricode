import { Component, createMemo, createSignal } from "solid-js"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@prioricode/ui/v2/dialog-v2"
import { ButtonV2 } from "@prioricode/ui/v2/button-v2"
import { TextInputV2 } from "@prioricode/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import "./model-config-dialog.css"

type Limit = { context: number; input?: number; output: number }

export const ModelConfigDialog: Component<{
  providerID: string
  modelID: string
  name: string
  limit: Limit
}> = (props) => {
  const language = useLanguage()
  const serverSync = useServerSync()

  const modelRef = createMemo(() => `${props.providerID}/${props.modelID}`)
  const override = createMemo(
    () => serverSync().data.config.provider?.[props.providerID]?.models?.[props.modelID]?.limit,
  )
  const isDefault = createMemo(() => serverSync().data.config.model === modelRef())
  const contextValue = createMemo(() => override()?.context ?? props.limit.context)
  const outputValue = createMemo(() => override()?.output ?? props.limit.output)

  const [contextDraft, setContextDraft] = createSignal<string | undefined>(undefined)
  const [outputDraft, setOutputDraft] = createSignal<string | undefined>(undefined)

  const parse = (raw: string | undefined, fallback: number): number => {
    const value = (raw ?? "").trim()
    if (value === "") return fallback
    const parsed = Number(value)
    if (Number.isNaN(parsed)) return fallback
    return Math.max(1, Math.trunc(parsed))
  }

  const commitLimits = () => {
    const context = parse(contextDraft(), contextValue())
    const output = parse(outputDraft(), outputValue())
    setContextDraft(undefined)
    setOutputDraft(undefined)
    if (context === contextValue() && output === outputValue()) return
    const next: Limit = { context, output }
    if (props.limit.input !== undefined) next.input = props.limit.input
    const provider = serverSync().data.config.provider?.[props.providerID]
    const models = provider?.models ?? {}
    void serverSync().updateConfig({
      provider: {
        [props.providerID]: {
          ...provider,
          models: {
            ...models,
            [props.modelID]: { limit: next },
          },
        },
      },
    })
  }

  const setDefault = () => {
    if (isDefault()) return
    void serverSync().updateConfig({ model: modelRef() })
  }

  return (
    <Dialog fit class="model-config-dialog">
      <DialogHeader>
        <DialogTitle>{props.name}</DialogTitle>
      </DialogHeader>
      <DialogBody class="model-config-dialog-body">
        <div class="model-config-row">
          <div class="model-config-row-text">
            <div class="model-config-row-title">{language.t("settings.models.config.default.title")}</div>
            <div class="model-config-row-description">{language.t("settings.models.config.default.description")}</div>
          </div>
          <ButtonV2
            size="small"
            variant={isDefault() ? "neutral" : "contrast"}
            disabled={isDefault()}
            onClick={setDefault}
          >
            {isDefault()
              ? language.t("settings.models.config.default.current")
              : language.t("settings.models.config.default.set")}
          </ButtonV2>
        </div>
        <div class="model-config-row">
          <div class="model-config-row-text">
            <div class="model-config-row-title">{language.t("settings.models.config.context.title")}</div>
            <div class="model-config-row-description">{language.t("settings.models.config.context.description")}</div>
          </div>
          <TextInputV2
            type="number"
            appearance="base"
            numeric
            min={1}
            value={contextDraft() ?? String(contextValue())}
            onInput={(event) => setContextDraft(event.currentTarget.value)}
            onBlur={commitLimits}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
            }}
            aria-label={language.t("settings.models.config.context.title")}
          />
        </div>
        <div class="model-config-row">
          <div class="model-config-row-text">
            <div class="model-config-row-title">{language.t("settings.models.config.output.title")}</div>
            <div class="model-config-row-description">{language.t("settings.models.config.output.description")}</div>
          </div>
          <TextInputV2
            type="number"
            appearance="base"
            numeric
            min={1}
            value={outputDraft() ?? String(outputValue())}
            onInput={(event) => setOutputDraft(event.currentTarget.value)}
            onBlur={commitLimits}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
            }}
            aria-label={language.t("settings.models.config.output.title")}
          />
        </div>
      </DialogBody>
    </Dialog>
  )
}
