import { useLocal } from "../context/local"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import type { PermissionMode } from "../context/permission"

const MODES: DialogSelectOption<PermissionMode>[] = [
  { value: "default", title: "Default", description: "Follow configured agent and project permissions" },
  { value: "ask-first", title: "Ask first", description: "Always confirm edits and bash commands" },
  { value: "always-allow", title: "Always allow", description: "Skip confirmations, except destructive bash" },
]

export function DialogPermission() {
  const local = useLocal()
  const dialog = useDialog()

  return (
    <DialogSelect
      title="Permission mode"
      current={local.permission.mode}
      options={MODES}
      onSelect={(option) => {
        local.permission.set(option.value)
        dialog.clear()
      }}
    />
  )
}
