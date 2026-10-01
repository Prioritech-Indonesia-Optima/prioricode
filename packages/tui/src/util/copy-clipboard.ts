import { SCENARIOS, clipboardSignals, resolveScenario } from "../clipboard-scenario"
import type { ClipboardService } from "../context/clipboard"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  error: (err: unknown) => void
}

/**
 * Writes the clipboard and reports honestly: a native tool success keeps the
 * classic toast, an OSC 52-only escape keeps the claim scoped to the terminal,
 * and a real failure says so instead of silently lying.
 */
export function copyWithToast(
  clipboard: ClipboardService,
  toast: Toast,
  text: string,
  successMessage = "Copied to clipboard",
): Promise<void> {
  const scenario = SCENARIOS[resolveScenario(clipboardSignals())]
  return Promise.resolve(clipboard?.write?.(text) ?? "failed")
    .then((result) => {
      if (result === "failed") {
        toast.show({ message: scenario.copyFailed, variant: "warning" })
        return
      }
      if (result === "osc52") {
        toast.show({ message: scenario.copyOsc52, variant: "info" })
        return
      }
      toast.show({ message: successMessage, variant: "info" })
    })
    .catch(toast.error)
}
