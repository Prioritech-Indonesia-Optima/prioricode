import { registerCustomTheme } from "@pierre/diffs"
import { PrioriCodeTheme } from "./marked-theme"

let registered = false

export function registerPrioriCodeTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("PrioriCode", () => Promise.resolve(PrioriCodeTheme))
}
