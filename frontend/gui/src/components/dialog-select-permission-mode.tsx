import { useDialog } from "@prioricode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@prioricode/ui/v2/dialog-v2"
import { For } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { showToast } from "@/utils/toast"
import "./dialog-select-permission-mode.css"

const MODES = [
  {
    value: "default",
    label: "dialog.permissionMode.default",
    description: "dialog.permissionMode.default.description",
  },
  {
    value: "ask-first",
    label: "dialog.permissionMode.askFirst",
    description: "dialog.permissionMode.askFirst.description",
  },
  {
    value: "always-allow",
    label: "dialog.permissionMode.alwaysAllow",
    description: "dialog.permissionMode.alwaysAllow.description",
  },
] as const

export type PermissionModeValue = (typeof MODES)[number]["value"]

export function DialogSelectPermissionMode(props: { sessionID: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()

  const current = () => sync().session.get(props.sessionID)?.permissionMode ?? "default"

  const pick = (mode: PermissionModeValue) => {
    const label = language.t(MODES.find((item) => item.value === mode)!.label)
    dialog.close()
    sdk()
      .client.session.update({ sessionID: props.sessionID, directory: sdk().directory, permissionMode: mode })
      .then(() => showToast({ title: language.t("toast.permissionMode.set", { mode: label }) }))
      .catch(() => showToast({ title: language.t("toast.permissionMode.failed"), variant: "error" }))
  }

  return (
    <Dialog fit class="dialog-select-permission-mode">
      <DialogHeader>
        <DialogTitle>{language.t("dialog.permissionMode.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="dialog-select-permission-mode-body">
        <div class="dialog-select-permission-mode-list" role="listbox">
          <For each={MODES}>
            {(mode) => (
              <button
                type="button"
                role="option"
                aria-selected={current() === mode.value}
                class="dialog-select-permission-mode-row"
                classList={{ "dialog-select-permission-mode-row--active": current() === mode.value }}
                onClick={() => pick(mode.value)}
              >
                <span class="dialog-select-permission-mode-name" dir="auto">
                  {language.t(mode.label)}
                </span>
                <span class="dialog-select-permission-mode-description" dir="auto">
                  {language.t(mode.description)}
                </span>
              </button>
            )}
          </For>
        </div>
      </DialogBody>
    </Dialog>
  )
}
