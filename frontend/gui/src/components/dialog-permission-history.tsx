import { createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { useDialog } from "@prioricode/ui/context/dialog"
import { Dialog } from "@prioricode/ui/dialog"
import { List } from "@prioricode/ui/list"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export function DialogPermissionHistory() {
  const params = useParams()
  const dialog = useDialog()
  const language = useLanguage()
  const permission = usePermission()

  const items = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return []
    return permission
      .history(sessionID)
      .slice()
      .reverse()
      .map((decision) => ({
        id: decision.id,
        title: `${decision.reply === "reject" ? "✗" : "✓"} ${decision.permission}${
          decision.patterns.length > 0 ? " · " + decision.patterns.join(", ") : ""
        }`,
        description: `${decision.reply} · ${formatTime(new Date(decision.time))}`,
      }))
  })

  return (
    <Dialog title={language.t("dialog.permissionHistory.title")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        emptyMessage={language.t("dialog.permissionHistory.empty")}
        key={(x) => x.id}
        items={items}
        filterKeys={["title"]}
        onSelect={() => dialog.close()}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="truncate flex-1 min-w-0 text-left font-normal">{item.title}</span>
            <span class="text-text-weak shrink-0 font-normal">{item.description}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
