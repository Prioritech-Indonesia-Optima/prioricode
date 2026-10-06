import { expect, test } from "@playwright/test"
import { mockPrioriCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/PrioriCode/HomeFlow"

test("shows the brand hero on the home and starts a session from the primary action", async ({ page }) => {
  await mockPrioriCodeServer(page, {
    directory,
    project: {
      id: "proj_home_flow",
      worktree: directory,
      vcs: "git",
      name: "HomeFlow",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: () => ({
      all: [
        {
          id: "prioricode",
          name: "PrioriCode",
          models: {
            "free-model": {
              id: "free-model",
              name: "Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["prioricode"],
      default: { providerID: "prioricode", modelID: "free-model" },
    }),
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: (path) =>
      path ? [] : [{ name: "HomeFlow", path: "HomeFlow", absolute: directory, type: "directory", ignored: false }],
    findFiles: () => ["HomeFlow"],
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("prioricode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
  })

  await page.goto("/")

  const hero = page.locator('[data-component="home-hero"]')
  await expectAppVisible(hero)
  await expect(hero).toContainText("Engineering that endures.")

  const addProject = page.locator('[data-action="home-add-project-row"]')
  await expectAppVisible(addProject)
  await addProject.click()
  await page.locator("[data-directory-path]").click()

  const newSession = page.locator('[data-action="home-new-session"]')
  await expectAppVisible(newSession)
  await newSession.click()
  await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))
})
