import { useDialog } from "@prioricode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@prioricode/ui/v2/dialog-v2"
import { LoaderV2 } from "@prioricode/ui/v2/loader-v2"
import { TextInputV2 } from "@prioricode/ui/v2/text-input-v2"
import { createQuery } from "@tanstack/solid-query"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import "./dialog-skill.css"

export function DialogSkill(props: { onSelect: (skillName: string) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const [store, setStore] = createStore({ filter: "" })

  const query = createQuery(() => ({
    queryKey: ["skills", sdk().directory],
    queryFn: async () => {
      const result = await sdk().api.skill.list()
      return result.data
    },
  }))

  const items = createMemo(() => {
    // A rejected query must not tear down the dialog: read data defensively.
    const list = query.data ?? []
    const query_ = store.filter.trim().toLowerCase()
    if (!query_) return list
    return list.filter(
      (skill) => skill.name.toLowerCase().includes(query_) || (skill.description ?? "").toLowerCase().includes(query_),
    )
  })

  const pick = (name: string) => {
    props.onSelect(name)
    dialog.close()
  }

  return (
    <Dialog fit class="dialog-skill">
      <DialogHeader>
        <DialogTitle>{language.t("dialog.skill.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="dialog-skill-body">
        <TextInputV2
          type="search"
          appearance="base"
          value={store.filter}
          onInput={(event) => setStore("filter", event.currentTarget.value)}
          placeholder={language.t("dialog.skill.search")}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          aria-label={language.t("dialog.skill.search")}
          class="dialog-skill-search"
        />
        <Show when={!query.isPending} fallback={<div class="dialog-skill-loading"><LoaderV2 /></div>}>
          <Show
            when={!query.isError}
            fallback={<div class="dialog-skill-empty">{language.t("dialog.skill.error")}</div>}
          >
            <Show when={items().length > 0} fallback={<div class="dialog-skill-empty">{language.t("dialog.skill.empty")}</div>}>
              <div class="dialog-skill-list">
                <For each={items()}>
                  {(skill) => (
                    <button type="button" class="dialog-skill-row" onClick={() => pick(skill.name)}>
                      <span class="dialog-skill-name" dir="ltr">
                        <bdi>{skill.name}</bdi>
                      </span>
                      <Show when={skill.description}>
                        <span class="dialog-skill-description" dir="auto">
                          {skill.description}
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
