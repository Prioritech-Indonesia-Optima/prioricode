import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@prioricode/core/util/encode"
import { mockPrioriCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/PrioriCode/AgentModeFlow"
const projectID = "proj_agent_mode_flow"
const sessionID = "ses_agent_mode_flow"

// Mirrors the server's native agent seeding order (cli/src/agent/agent.ts): build first.
const nativeAgents = [
  { name: "build", mode: "primary", native: true, hidden: false, permission: [] },
  { name: "plan", mode: "primary", native: true, hidden: false, permission: [] },
  { name: "auto", mode: "primary", native: true, hidden: false, permission: [] },
]
const customAgent = { name: "reviewer", mode: "primary", native: false, hidden: false, permission: [] }

async function mountComposer(page: Page, agents: unknown[]) {
  await mockPrioriCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "agent-mode-flow",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "prioricode",
          name: "PrioriCode",
          models: {
            "go-model": {
              id: "go-model",
              name: "Go Model",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000, output: 8_192 },
            },
          },
        },
      ],
      connected: ["prioricode"],
      default: { providerID: "prioricode", modelID: "go-model" },
    },
    agents,
    sessions: [
      {
        id: sessionID,
        slug: "agent-mode-flow",
        projectID,
        directory,
        title: "Agent mode flow",
        version: "dev",
        time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: { newLayoutDesigns: true, agentVisibilityInitialized: true, showCustomAgents: false },
      }),
    )
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  const composer = page.locator('[data-component="prompt-input-v2"]')
  await expectAppVisible(composer)
  return composer
}

test("native agents are selectable in the composer without enabling custom agents", async ({ page }) => {
  const composer = await mountComposer(page, [...nativeAgents, customAgent])

  const agentControl = composer.getByRole("button", { name: "Choose agent" })
  await expect(agentControl).toBeVisible()
  await expect(agentControl).toContainText("build")

  await agentControl.click()
  const plan = page.getByRole("menuitemradio", { name: "plan" })
  await expect(plan).toBeVisible()
  await plan.click()

  await expect(agentControl).toContainText("plan")
})

test("/mode opens the agent picker dialog and switches the active agent", async ({ page }) => {
  const composer = await mountComposer(page, [...nativeAgents, customAgent])
  const input = composer.locator('[data-component="prompt-input"]')

  await input.click()
  await input.type("/mode")
  const suggestion = page.locator('[data-suggestion-id="agent.mode"]')
  await expect(suggestion).toBeVisible()
  await suggestion.click()

  const dialog = page.getByRole("dialog", { name: "Choose agent" })
  await expect(dialog).toBeVisible()
  const listbox = dialog.getByRole("listbox")
  await expect(listbox.getByRole("option", { name: /build/ })).toBeVisible()
  await expect(listbox.getByRole("option", { name: /plan/ })).toBeVisible()
  await expect(listbox.getByRole("option", { name: /auto/ })).toBeVisible()
  await expect(listbox.getByRole("option", { name: /reviewer/ })).toHaveCount(0)

  await listbox.getByRole("option", { name: /auto/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(composer.getByRole("button", { name: "Choose agent" })).toContainText("auto")
})

test("/agents opens the same agent picker dialog", async ({ page }) => {
  const composer = await mountComposer(page, nativeAgents)
  const input = composer.locator('[data-component="prompt-input"]')

  await input.click()
  await input.type("/agents")
  const suggestion = page.locator('[data-suggestion-id="agent.select"]')
  await expect(suggestion).toBeVisible()
  await suggestion.click()
  await expect(page.getByRole("dialog", { name: "Choose agent" })).toBeVisible()
})
