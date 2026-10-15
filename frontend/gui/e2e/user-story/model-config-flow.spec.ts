import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@prioricode/core/util/encode"
import { mockPrioriCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/PrioriCode/ModelConfigFlow"
const projectID = "proj_model_config_flow"
const sessionID = "ses_model_config_flow"

function providerFixture() {
  return {
    all: [
      {
        id: "e2e",
        name: "E2E Provider",
        models: {
          "e2e-model": {
            id: "e2e-model",
            name: "E2E Model",
            cost: { input: 1, output: 1 },
            limit: { context: 200_000, output: 8_192 },
          },
        },
      },
    ],
    connected: ["e2e"],
    default: { providerID: "e2e", modelID: "e2e-model" },
  }
}

async function openSettings(page: Page, updates: Record<string, unknown>[], globalConfig?: Record<string, unknown>) {
  await mockPrioriCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "model-config-flow",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: providerFixture(),
    globalConfig,
    onConfigUpdate: (body) => updates.push(body),
    sessions: [
      {
        id: sessionID,
        slug: "model-config-flow",
        projectID,
        directory,
        title: "Model config flow",
        version: "dev",
        time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))
  await page.keyboard.press("Control+,")
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  return dialog
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function path(value: unknown, ...keys: string[]): unknown {
  return keys.reduce((acc, key) => (isRecord(acc) ? acc[key] : undefined), value)
}

test("Context tab persists compaction settings to the global config", async ({ page }) => {
  const updates: Record<string, unknown>[] = []
  const dialog = await openSettings(page, updates)

  await dialog.getByRole("tab", { name: "Context" }).click()
  const auto = dialog.locator('[data-action="settings-compaction-auto"]')
  const autoSwitch = auto.getByRole("switch")
  await expect(autoSwitch).toBeChecked()

  await auto.locator('[data-slot="switch-control"]').click()
  await expect.poll(() => updates.some((u) => path(u, "compaction", "auto") === false)).toBe(true)
  await expect(autoSwitch).not.toBeChecked()

  const threshold = dialog.locator('input[data-action="settings-compaction-threshold"]')
  await threshold.fill("90")
  await threshold.press("Enter")
  await expect.poll(() => updates.some((u) => path(u, "compaction", "threshold") === 90)).toBe(true)
  await expect(threshold).toHaveValue("90")
})

test("Models tab per-model config sets context window and default model", async ({ page }) => {
  const updates: Record<string, unknown>[] = []
  const dialog = await openSettings(page, updates)

  await dialog.getByRole("tab", { name: "Models" }).click()
  await dialog.getByRole("button", { name: "Configure model" }).click()

  const config = page.getByRole("dialog", { name: "E2E Model" })
  await expect(config).toBeVisible()

  const context = config.getByLabel("Context window")
  await expect(context).toHaveValue("200000")
  await context.fill("100000")
  await context.press("Enter")
  await expect
    .poll(() => updates.some((u) => path(u, "provider", "e2e", "models", "e2e-model", "limit", "context") === 100000))
    .toBe(true)
  await expect(context).toHaveValue("100000")

  await config.getByRole("button", { name: "Set as default" }).click()
  await expect.poll(() => updates.some((u) => u.model === "e2e/e2e-model")).toBe(true)
  await expect(config.getByRole("button", { name: "Default" })).toBeDisabled()
})
