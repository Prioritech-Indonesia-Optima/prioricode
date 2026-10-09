import { useDialog } from "@prioricode/ui/context/dialog"
import { createMemo, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { openAddSshServer, SshServerSettings, useFilteredSshServers } from "@/ssh/settings"
import { ServerConnectionForm, ServerConnectionList, useServerManagementController } from "./dialog-select-server"

export const SettingsServers: Component = () => {
  const language = useLanguage()
  const controller = useServerManagementController()
  const platform = usePlatform()
  const dialog = useDialog()
  const emptyFilter = createMemo(() => "")
  const sshServers = useFilteredSshServers(emptyFilter)

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="flex flex-col flex-1 min-h-0 max-w-[720px]">
        <Show
          when={controller.isFormMode()}
          fallback={
            <>
              <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
                <div class="flex flex-col gap-1 pt-6 pb-8">
                  <h2 class="text-16-medium text-text-strong">{language.t("status.popover.tab.servers")}</h2>
                </div>
              </div>
              <ServerConnectionList controller={controller} />
              <Show when={platform.sshServers}>
                <div class="flex flex-col gap-2 pt-8">
                  <div class="flex items-center justify-between">
                    <h2 class="text-16-medium text-text-strong">{language.t("ssh.server.menu.label")}</h2>
                    <button
                      type="button"
                      class="text-13-medium text-text-interactive"
                      onClick={() => openAddSshServer(dialog)}
                    >
                      {language.t("ssh.server.add")}
                    </button>
                  </div>
                  <SshServerSettings controller={controller} servers={sshServers} />
                </div>
              </Show>
            </>
          }
        >
          <div class="flex flex-1 min-h-0 flex-col gap-4 pt-6">
            <div class="text-16-medium text-text-strong">{controller.formTitle()}</div>
            <ServerConnectionForm controller={controller} />
          </div>
        </Show>
      </div>
    </div>
  )
}
