import { createMemo } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"

type Patch = Record<string, unknown>

export function DialogModelSettings(props: { providerID: string; modelID: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()

  const model = createMemo(() =>
    sync.data.provider
      .find((provider) => provider.id === props.providerID)
      ?.models[props.modelID],
  )

  const title = createMemo(() => model()?.name ?? props.modelID)

  async function apply(patch: Patch, label: string) {
    try {
      await sdk.client.global.config.update({ config: patch }, { throwOnError: true })
      await sync.bootstrap({ fatal: false }).catch(() => undefined)
      toast.show({ message: `Saved ${label}`, variant: "success" })
      dialog.clear()
    } catch (err) {
      toast.error(err)
    }
  }

  function limitPatch(next: { context: number; output: number }): Patch {
    return {
      provider: {
        [props.providerID]: {
          models: {
            [props.modelID]: { limit: next },
          },
        },
      },
    }
  }

  function promptNumber(label: string, current: number | undefined, hint: string, write: (value: number) => Patch) {
    dialog.replace(() => (
      <DialogPrompt
        title={`${label} (${title()})`}
        placeholder={hint}
        value={current === undefined ? "" : String(current)}
        onConfirm={(raw) => {
          const parsed = Number(raw.trim())
          if (!Number.isFinite(parsed) || parsed <= 0) {
            toast.show({ message: "Enter a positive number", variant: "error" })
            return
          }
          void apply(write(parsed), label)
        }}
        onCancel={() => dialog.replace(() => <DialogModelSettings providerID={props.providerID} modelID={props.modelID} />)}
      />
    ))
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const limit = model()?.limit
    return [
      {
        title: "Set as default model",
        value: "default",
        description: "Use this model for new sessions",
        footer: sync.data.config.model === `${props.providerID}/${props.modelID}` ? "current" : undefined,
        onSelect: () => void apply({ model: `${props.providerID}/${props.modelID}` }, "default model"),
      },
      {
        title: "Context window",
        value: "context",
        description: "Total context window in tokens (drives when compaction fires)",
        footer: limit?.context === undefined ? "not set" : String(limit.context),
        onSelect: () =>
          promptNumber("Context window", limit?.context, "200000", (v) =>
            limitPatch({ context: v, output: limit?.output ?? 8192 }),
          ),
      },
      {
        title: "Output limit",
        value: "output",
        description: "Maximum output tokens per response",
        footer: limit?.output === undefined ? "not set" : String(limit.output),
        onSelect: () =>
          promptNumber("Output limit", limit?.output, "8192", (v) =>
            limitPatch({ context: limit?.context ?? 200000, output: v }),
          ),
      },
      {
        title: "Compaction threshold",
        value: "threshold",
        description: "Percent of the context window that triggers auto-compaction (1-100)",
        footer:
          sync.data.config.compaction?.threshold === undefined
            ? "not set"
            : `${sync.data.config.compaction.threshold}%`,
        onSelect: () =>
          promptNumber(
            "Compaction threshold (%)",
            sync.data.config.compaction?.threshold,
            "85",
            (v) => ({ compaction: { ...sync.data.config.compaction, threshold: Math.min(v, 100) } }),
          ),
      },
    ]
  })

  return (
    <DialogSelect
      title={`Settings · ${title()}`}
      options={options()}
      current="default"
      onSelect={() => dialog.clear()}
    />
  )
}
