import { useDialog } from "@prioricode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@prioricode/ui/v2/dialog-v2"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import "./dialog-select-agent.css"

export function DialogSelectAgent() {
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()

  const agents = local.agent.list()
  const current = local.agent.current()?.name

  const pick = (name: string) => {
    local.agent.set(name)
    dialog.close()
  }

  return (
    <Dialog fit class="dialog-select-agent">
      <DialogHeader>
        <DialogTitle>{language.t("dialog.agent.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="dialog-select-agent-body">
        <div class="dialog-select-agent-list" role="listbox">
          <For each={agents}>
            {(agent) => (
              <button
                type="button"
                role="option"
                aria-selected={agent.name === current}
                class="dialog-select-agent-row"
                classList={{ "dialog-select-agent-row--active": agent.name === current }}
                onClick={() => pick(agent.name)}
              >
                <span class="dialog-select-agent-name" dir="ltr">
                  <bdi>{agent.name}</bdi>
                </span>
                <Show when={agent.native === false && agent.description}>
                  <span class="dialog-select-agent-description" dir="auto">
                    {agent.description}
                  </span>
                </Show>
                <Show when={agent.native !== false}>
                  <span class="dialog-select-agent-native">{language.t("dialog.agent.native")}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </DialogBody>
    </Dialog>
  )
}
