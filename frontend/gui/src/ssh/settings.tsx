import { base64Encode } from "@prioricode/core/util/encode"
import { useDialog } from "@prioricode/ui/context/dialog"
import { Tag } from "@prioricode/ui/v2/badge-v2"
import { ButtonV2 } from "@prioricode/ui/v2/button-v2"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@prioricode/ui/v2/dialog-v2"
import { Icon as IconV2 } from "@prioricode/ui/v2/icon"
import { IconButtonV2 } from "@prioricode/ui/v2/icon-button-v2"
import { MenuV2 } from "@prioricode/ui/v2/menu-v2"
import { TextInputV2 } from "@prioricode/ui/v2/text-input-v2"
import { useMutation } from "@tanstack/solid-query"
import fuzzysort from "fuzzysort"
import { type Accessor, For, Show, createMemo, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import type { useServerManagementController } from "@/components/dialog-select-server"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
import { showToast } from "@/utils/toast"
import { DialogAddSshServer } from "./dialog-add-server"
import { useSshServers } from "./context"
import { sshPrioricodeAction, sshRuntimeRetryable } from "./settings-model"
import type { SshServerItem } from "./types"

type Controller = ReturnType<typeof useServerManagementController>

export function isSshServer(server: ServerConnection.Any) {
  return server.type === "ssh"
}

export function openAddSshServer(dialog: ReturnType<typeof useDialog>) {
  dialog.push(() => <DialogAddSshServer />)
}

function DialogSshWorkspace(props: { item: SshServerItem }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const [value, setValue] = createSignal(props.item.config.workspace ?? "")
  const save = () => {
    const api = platform.sshServers
    if (!api) return
    void api
      .setWorkspace(props.item.config.id, value())
      .then(() => dialog.close())
      .catch((error) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("ssh.server.workspace.dialogTitle", { host: props.item.config.alias })}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex flex-col gap-2 p-4">
        <TextInputV2
          type="text"
          appearance="base"
          value={value()}
          onInput={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save()
          }}
          placeholder={language.t("ssh.server.workspace.placeholder")}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          dir="ltr"
        />
        <div class="flex justify-end">
          <ButtonV2 size="small" variant="contrast" onClick={save}>
            {language.t("ssh.server.workspace.save")}
          </ButtonV2>
        </div>
      </DialogBody>
    </Dialog>
  )
}

export function useFilteredSshServers(filter: Accessor<string>) {
  const ssh = useSshServers()
  return createMemo(() => {
    const servers = ssh.data?.servers ?? []
    const query = filter().trim()
    if (!query) return servers
    return fuzzysort
      .go(query, servers, { keys: [(item) => item.config.alias, (item) => item.config.id] })
      .map((x) => x.obj)
  })
}

export function SshServerSettings(props: {
  controller: Controller
  servers: ReturnType<typeof useFilteredSshServers>
}) {
  const platform = usePlatform()
  const language = useLanguage()
  const ssh = useSshServers()
  const api = platform.sshServers
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const global = useGlobal()

  const request = useMutation(() => ({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))

  const remove = (key: ServerConnection.Key) => {
    request.mutate(() => props.controller.handleRemove(key))
  }

  const openWorkspace = (item: SshServerItem) => {
    const workspace = item.config.workspace
    if (!workspace || item.runtime.kind !== "ready") return
    const conn: ServerConnection.Any = {
      type: "ssh",
      host: item.config.alias,
      workspace,
      http: {
        url: item.runtime.url,
        username: item.runtime.username ?? undefined,
        password: item.runtime.password ?? undefined,
      },
    }
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(workspace)
    ctx.projects.touch(workspace)
    server.setActive(ServerConnection.key(conn))
    navigate(`/${base64Encode(workspace)}/session`)
  }

  return (
    <Show when={api}>
      <For each={props.servers()}>
        {(item) => {
          const key = ServerConnection.Key.make(item.config.id)
          const check = () => ssh.data?.prioricodeChecks[item.config.alias]
          const prioricodeAction = () => sshPrioricodeAction(check())
          const busy = () => ssh.data?.job?.kind === "install-prioricode" && ssh.data.job.alias === item.config.alias
          const connected = () => item.runtime.kind === "ready"
          return (
            <div class="settings-v2-servers-row">
              <div class="settings-v2-servers-lead">
                <ServerHealthIndicator health={props.controller.status()[key]} />
                <div class="settings-v2-servers-copy">
                  <span class="flex min-w-0 items-center gap-1">
                    <span class="settings-v2-servers-name" dir="ltr">
                      <bdi>{item.config.alias}</bdi>
                    </span>
                    <span class="shrink-0 rounded-[3px] border border-pc-border-base px-1 py-0.5 text-[9px] leading-none text-pc-text-muted">
                      {language.t("ssh.server.label")}
                    </span>
                  </span>
                  <span class="settings-v2-servers-meta">
                    <Show when={check()?.version}>{(version) => `v${version()}`}</Show>
                    <Show when={item.config.workspace}>
                      {(workspace) => (
                        <span class="truncate" dir="ltr">
                          <bdi>{workspace()}</bdi>
                        </span>
                      )}
                    </Show>
                  </span>
                </div>
              </div>
              <div class="settings-v2-servers-actions">
                <Show when={props.controller.canDefault() && props.controller.defaultKey() === key}>
                  <Tag>{language.t("dialog.server.status.default")}</Tag>
                </Show>
                <Show when={prioricodeAction()}>
                  {(label) => (
                    <ButtonV2
                      size="small"
                      disabled={busy() || request.isPending}
                      onClick={() => api && request.mutate(() => api.installPrioricode(item.config.alias))}
                    >
                      {busy() ? language.t("ssh.server.updating") : language.t(label())}
                    </ButtonV2>
                  )}
                </Show>
                <MenuV2 gutter={4} modal={false} placement="bottom-end">
                  <MenuV2.Trigger
                    as={IconButtonV2}
                    variant="ghost-muted"
                    size="small"
                    icon={<IconV2 name="outline-dots" />}
                    aria-label={language.t("common.moreOptions")}
                  />
                  <MenuV2.Portal>
                    <MenuV2.Content>
                      <MenuV2.Group>
                        <MenuV2.GroupLabel>{language.t("ssh.server.menu.label")}</MenuV2.GroupLabel>
                        <Show when={sshRuntimeRetryable(item.runtime)}>
                          <MenuV2.Item onSelect={() => api && request.mutate(() => api.startServer(key))}>
                            {language.t("ssh.server.retryStart")}
                          </MenuV2.Item>
                        </Show>
                        <Show when={connected()}>
                          <MenuV2.Item onSelect={() => api && request.mutate(() => api.stopServer(key))}>
                            {language.t("ssh.server.stop")}
                          </MenuV2.Item>
                        </Show>
                        <Show when={connected() && item.config.workspace}>
                          <MenuV2.Item onSelect={() => openWorkspace(item)}>
                            {language.t("ssh.server.workspace.open")}
                          </MenuV2.Item>
                        </Show>
                        <MenuV2.Item onSelect={() => dialog.push(() => <DialogSshWorkspace item={item} />)}>
                          {language.t("ssh.server.workspace.edit")}
                        </MenuV2.Item>
                        <Show when={props.controller.canDefault() && props.controller.defaultKey() !== key}>
                          <MenuV2.Item onSelect={() => props.controller.setDefault(key)}>
                            {language.t("dialog.server.menu.default")}
                          </MenuV2.Item>
                        </Show>
                        <Show when={props.controller.canDefault() && props.controller.defaultKey() === key}>
                          <MenuV2.Item onSelect={() => props.controller.setDefault(null)}>
                            {language.t("dialog.server.menu.defaultRemove")}
                          </MenuV2.Item>
                        </Show>
                        <MenuV2.Separator />
                        <MenuV2.Item onSelect={() => remove(key)}>
                          {language.t("dialog.server.menu.delete")}
                        </MenuV2.Item>
                      </MenuV2.Group>
                    </MenuV2.Content>
                  </MenuV2.Portal>
                </MenuV2>
              </div>
            </div>
          )
        }}
      </For>
    </Show>
  )
}
