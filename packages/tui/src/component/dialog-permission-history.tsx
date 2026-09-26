import { createMemo } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { usePermission } from "../context/permission"
import { useRoute } from "../context/route"
import { Locale } from "../util/locale"

// Recent answered permission requests for the current session (process-local
// view kept by the sync reducer; the durable record stays in session events).
export function DialogPermissionHistory() {
  const dialog = useDialog()
  const route = useRoute()
  const permission = usePermission()

  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const options = createMemo<DialogSelectOption<string>[]>(() =>
    permission
      .history(sessionID())
      .slice()
      .reverse()
      .map((decision) => ({
        value: decision.id,
        title: `${decision.reply === "reject" ? "✗" : "✓"} ${decision.permission}${
          decision.patterns.length > 0 ? " · " + decision.patterns.join(", ") : ""
        }`,
        description: `${decision.reply} · ${Locale.todayTimeOrDateTime(decision.time)}`,
      })),
  )

  return (
    <DialogSelect
      title="Permission history (this session)"
      options={options()}
      onSelect={() => {
        dialog.clear()
      }}
    />
  )
}
