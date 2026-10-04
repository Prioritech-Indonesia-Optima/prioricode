import { useDialog } from "@prioricode/ui/context/dialog"
import { ButtonV2 } from "@prioricode/ui/v2/button-v2"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@prioricode/ui/v2/dialog-v2"
import { IconButtonV2 } from "@prioricode/ui/v2/icon-button-v2"
import { LoaderV2 } from "@prioricode/ui/v2/loader-v2"
import { Icon as IconV2 } from "@prioricode/ui/v2/icon"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import "./dialog-saved-permissions.css"

export function DialogSavedPermissions() {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()
  const queryKey = ["permission-saved"] as const

  const query = createQuery(() => ({
    queryKey,
    queryFn: () => serverSDK().api.permission.saved.list(),
  }))

  const remove = async (id: string) => {
    try {
      await serverSDK().api.permission.saved.remove({ id })
      await queryClient.invalidateQueries({ queryKey })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <Dialog fit class="dialog-saved-permissions">
      <DialogHeader>
        <DialogTitle>{language.t("dialog.savedPermissions.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="dialog-saved-permissions-body">
        <Show when={!query.isPending} fallback={<div class="dialog-saved-permissions-loading"><LoaderV2 /></div>}>
          <Show when={!query.isError} fallback={<div class="dialog-saved-permissions-empty">{language.t("dialog.savedPermissions.error")}</div>}>
            <Show when={(query.data ?? []).length > 0} fallback={<div class="dialog-saved-permissions-empty">{language.t("dialog.savedPermissions.empty")}</div>}>
              <div class="dialog-saved-permissions-list">
                <For each={query.data ?? []}>
                  {(rule) => (
                    <div class="dialog-saved-permissions-row">
                      <div class="dialog-saved-permissions-copy">
                        <span class="dialog-saved-permissions-rule" dir="ltr">
                          <bdi>{rule.action}</bdi>
                          <span class="dialog-saved-permissions-separator"> · </span>
                          <bdi>{rule.resource}</bdi>
                        </span>
                        <span class="dialog-saved-permissions-project" dir="ltr">
                          <bdi>{rule.projectID}</bdi>
                        </span>
                      </div>
                      <IconButtonV2
                        variant="ghost-muted"
                        size="small"
                        icon={<IconV2 name="trash" />}
                        aria-label={language.t("dialog.savedPermissions.remove")}
                        disabled={query.isFetching}
                        onClick={() => void remove(rule.id)}
                      />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
        <div class="dialog-saved-permissions-footer">
          <ButtonV2 variant="neutral" size="small" onClick={() => dialog.close()}>
            {language.t("dialog.savedPermissions.close")}
          </ButtonV2>
        </div>
      </DialogBody>
    </Dialog>
  )
}
