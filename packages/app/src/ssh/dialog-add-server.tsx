import { useDialog } from "@prioricode/ui/context/dialog"
import { ButtonV2 } from "@prioricode/ui/v2/button-v2"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@prioricode/ui/v2/dialog-v2"
import { LoaderV2 } from "@prioricode/ui/v2/loader-v2"
import { TextInputV2 } from "@prioricode/ui/v2/text-input-v2"
import { useMutation } from "@tanstack/solid-query"
import fuzzysort from "fuzzysort"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"
import { useSshServers } from "./context"
import { sshHostMeta, sshPrioricodeAction } from "./settings-model"
import "./dialog-add-ssh-server.css"

export function DialogAddSshServer() {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const ssh = useSshServers()
  const api = platform.sshServers
  const [store, setStore] = createStore({ filter: "", manual: "" })
  const [added, setAdded] = createSignal(false)

  createEffect(() => {
    if (!api) return
    if (ssh.data && ssh.data.hosts.length === 0) void api.refreshHosts().catch(() => undefined)
  })

  const request = useMutation(() => ({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  const hosts = createMemo(() => {
    const items = ssh.data?.hosts ?? []
    const query = store.filter.trim()
    if (!query) return items
    return fuzzysort
      .go(query, items, { keys: [(item) => item.alias, (item) => item.hostname ?? ""] })
      .map((result) => result.obj)
  })

  const serverFor = (alias: string) => ssh.data?.servers.find((item) => item.config.alias === alias)
  const checkFor = (alias: string) => ssh.data?.prioricodeChecks[alias]
  const refreshing = createMemo(() => ssh.data?.job?.kind === "hosts")

  const add = (alias: string) => {
    if (!api) return
    request.mutate(async () => {
      await api.addServer(alias)
      setAdded(true)
    })
  }

  return (
    <Dialog fit class="settings-v2-ssh-dialog">
      <DialogHeader>
        <DialogTitle>{language.t("ssh.server.dialog.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="settings-v2-ssh-dialog-body">
        <p class="settings-v2-ssh-dialog-description">{language.t("ssh.server.dialog.description")}</p>
        <div class="settings-v2-ssh-toolbar">
          <TextInputV2
            type="search"
            appearance="base"
            value={store.filter}
            onInput={(event) => setStore("filter", event.currentTarget.value)}
            placeholder={language.t("ssh.server.dialog.search")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            aria-label={language.t("ssh.server.dialog.search")}
            class="settings-v2-ssh-search"
          />
          <ButtonV2
            variant="ghost-muted"
            size="small"
            disabled={!api || refreshing()}
            onClick={() => api && request.mutate(() => api.refreshHosts())}
          >
            {refreshing() ? language.t("ssh.server.checking") : language.t("ssh.server.refresh")}
          </ButtonV2>
        </div>

        <Show
          when={!ssh.isPending}
          fallback={
            <div class="settings-v2-ssh-loading">
              <LoaderV2 />
            </div>
          }
        >
          <Show
            when={hosts().length > 0}
            fallback={<div class="settings-v2-ssh-empty">{language.t("ssh.server.empty")}</div>}
          >
            <div class="settings-v2-ssh-list">
              <For each={hosts()}>
                {(host) => {
                  const server = () => serverFor(host.alias)
                  const check = () => checkFor(host.alias)
                  const installAction = () => sshPrioricodeAction(check())
                  const installing = () =>
                    ssh.data?.job?.kind === "install-prioricode" && ssh.data.job.alias === host.alias
                  const failedMessage = () =>
                    server()?.runtime.kind === "failed"
                      ? (server()!.runtime as { kind: "failed"; message: string }).message
                      : null
                  return (
                    <div class="settings-v2-ssh-row">
                      <div class="settings-v2-ssh-row-copy">
                        <span class="settings-v2-ssh-row-name" dir="ltr">
                          <bdi>{host.alias}</bdi>
                        </span>
                        <span class="settings-v2-ssh-row-meta" dir="ltr">
                          <bdi>{sshHostMeta(host)}</bdi>
                          <Show when={host.hasProxy}>
                            <span class="settings-v2-ssh-row-badge" dir="auto">
                              {" "}
                              · {language.t("ssh.server.viaJump")}
                            </span>
                          </Show>
                        </span>
                        <Show when={check()?.error && !check()?.resolvedPath}>
                          {(error) => (
                            <span class="settings-v2-ssh-row-status settings-v2-ssh-row-status--warning" dir="auto">
                              {error()}
                            </span>
                          )}
                        </Show>
                        <Show when={failedMessage()}>
                          {(message) => (
                            <span class="settings-v2-ssh-row-status settings-v2-ssh-row-status--error" dir="auto">
                              {message()}
                            </span>
                          )}
                        </Show>
                      </div>
                      <div class="settings-v2-ssh-row-actions">
                        <Show when={installAction()}>
                          {(label) => (
                            <ButtonV2
                              size="small"
                              variant="neutral"
                              disabled={installing() || request.isPending}
                              onClick={() => api && request.mutate(() => api.installPrioricode(host.alias))}
                            >
                              {installing() ? language.t("ssh.server.updating") : language.t(label())}
                            </ButtonV2>
                          )}
                        </Show>
                        <Show
                          when={server()}
                          fallback={
                            <ButtonV2
                              size="small"
                              variant="contrast"
                              disabled={request.isPending || added()}
                              onClick={() => add(host.alias)}
                            >
                              {language.t("ssh.server.dialog.add")}
                            </ButtonV2>
                          }
                        >
                          {(item) => (
                            <Show
                              when={item().runtime.kind !== "ready" && item().runtime.kind !== "starting"}
                              fallback={
                                <span class="settings-v2-ssh-row-status">
                                  {item().runtime.kind === "starting"
                                    ? language.t("ssh.server.status.starting")
                                    : language.t("ssh.server.status.connected")}
                                </span>
                              }
                            >
                              <ButtonV2
                                size="small"
                                variant="neutral"
                                disabled={request.isPending}
                                onClick={() => api && request.mutate(() => api.startServer(item().config.id))}
                              >
                                {language.t("ssh.server.start")}
                              </ButtonV2>
                            </Show>
                          )}
                        </Show>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </Show>

        <div class="settings-v2-ssh-manual">
          <TextInputV2
            type="text"
            appearance="base"
            value={store.manual}
            onInput={(event) => setStore("manual", event.currentTarget.value)}
            placeholder={language.t("ssh.server.manual.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            aria-label={language.t("ssh.server.manual.placeholder")}
            class="settings-v2-ssh-search"
          />
          <ButtonV2
            size="small"
            variant="neutral"
            disabled={!api || !store.manual.trim() || request.isPending}
            onClick={() => add(store.manual.trim())}
          >
            {language.t("ssh.server.manual.add")}
          </ButtonV2>
        </div>
      </DialogBody>
    </Dialog>
  )
}
