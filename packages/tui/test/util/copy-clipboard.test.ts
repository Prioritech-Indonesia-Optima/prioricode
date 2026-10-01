import { expect, test } from "bun:test"
import { copyWithToast } from "../../src/util/copy-clipboard"
import type { ClipboardService, CopyResult } from "../../src/context/clipboard"

function harness(result: CopyResult | void) {
  const shown: { message: string; variant: string }[] = []
  const toast = {
    show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) =>
      shown.push({ message: input.message, variant: input.variant }),
    error: () => {},
  }
  const clipboard: ClipboardService = { write: async () => result }
  return { clipboard, toast, shown }
}

test("copy toasts report the actual transport", async () => {
  const native = harness("native")
  await copyWithToast(native.clipboard, native.toast, "hi")
  expect(native.shown).toEqual([{ message: "Copied to clipboard", variant: "info" }])

  const osc52 = harness("osc52")
  await copyWithToast(osc52.clipboard, osc52.toast, "hi")
  expect(osc52.shown[0]?.message).toContain("OSC 52")

  const failed = harness("failed")
  await copyWithToast(failed.clipboard, failed.toast, "hi")
  expect(failed.shown[0]?.variant).toBe("warning")

  const legacy = harness(undefined)
  await copyWithToast(legacy.clipboard, legacy.toast, "hi", "Copied worktree path")
  expect(legacy.shown).toEqual([{ message: "Copied worktree path", variant: "info" }])
})
