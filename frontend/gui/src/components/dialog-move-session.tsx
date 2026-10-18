import { Component, createMemo, createResource, createSignal } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useDialog } from "@prioricode/ui/context/dialog"
import { Dialog } from "@prioricode/ui/dialog"
import { List } from "@prioricode/ui/list"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@prioricode/core/util/encode"
import { requireServerKey, sessionHref } from "@/utils/session-route"

type DirectoryItem = {
  directory: string
  isCurrent: boolean
}

export const DialogMoveSession: Component = () => {
  const params = useParams()
  const navigate = useNavigate()
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const [working, setWorking] = createSignal(false)

  const sessionID = createMemo(() => params.id)

  const [directories] = createResource(
    () => sessionID(),
    async (id) => {
      if (!id) return []
      try {
        const session = sync().session.get(id)
        if (!session) return []
        const projectID = session.projectID
        if (!projectID) return []
        const result = await sdk().client.project.directories({ projectID })
        const current = sdk().directory
        return (result.data ?? []).map((d) => ({
          directory: d.directory,
          isCurrent: d.directory === current,
        }))
      } catch {
        return []
      }
    },
  )

  const items = createMemo<DirectoryItem[]>(() => {
    const dirs = directories() ?? []
    if (dirs.length === 0) return []
    return [...dirs].sort((a, b) => {
      if (a.isCurrent) return -1
      if (b.isCurrent) return 1
      return a.directory.localeCompare(b.directory)
    })
  })

  const handleSelect = async (item: DirectoryItem | undefined) => {
    if (!item || item.isCurrent || working()) return
    const id = sessionID()
    if (!id) return

    setWorking(true)
    try {
      await sdk().client.experimental.controlPlane.moveSession({
        sessionID: id,
        destination: { directory: item.directory },
        moveChanges: false,
      })
      dialog.close()
      const dir = base64Encode(item.directory)
      navigate(params.serverKey ? sessionHref(requireServerKey(params.serverKey), id) : `/${dir}/session/${id}`)
      showToast({
        variant: "success",
        title: language.t("dialog.moveSession.success.title"),
        description: language.t("dialog.moveSession.success.description", { directory: item.directory }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("dialog.moveSession.failed.title"),
        description: err instanceof Error ? err.message : language.t("dialog.moveSession.failed.description"),
      })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog title={language.t("dialog.moveSession.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("dialog.moveSession.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.moveSession.empty")}
        key={(x) => x.directory}
        items={items}
        filterKeys={["directory"]}
        onSelect={handleSelect}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="truncate flex-1 min-w-0 text-left font-normal" dir="ltr">
              {item.directory}
            </span>
            {item.isCurrent && (
              <span class="text-text-weak shrink-0 font-normal">{language.t("dialog.moveSession.current")}</span>
            )}
          </div>
        )}
      </List>
    </Dialog>
  )
}
