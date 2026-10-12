import { expect, test } from "@playwright/test"
import { base64Encode } from "@prioricode/core/util/encode"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockPrioriCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const SHOTS = "e2e/visual/shots"

const homeProvider = {
  all: [
    {
      id: "prioricode",
      name: "PrioriCode",
      models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
    },
  ],
  connected: ["prioricode"],
  default: { providerID: "prioricode", modelID: "claude-opus-4-6" },
}

const homeFileList = (path: string) =>
  path
    ? []
    : [{ name: "smoke-project", path: "smoke-project", absolute: fixture.directory, type: "directory", ignored: false }]

async function newLayout(page: Parameters<typeof mockPrioriCodeServer>[0]) {
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "prioricode.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: { local: directory } }),
    )
  }, fixture.directory)
}

async function legacyLayout(page: Parameters<typeof mockPrioriCodeServer>[0]) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { editToolPartsExpanded: true, shellToolPartsExpanded: true, showReasoningSummaries: true } }),
    )
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "prioricode.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: { local: directory } }),
    )
  }, fixture.directory)
}

test("home (new layout): hero, project and session rows", async ({ page }) => {
  await mockPrioriCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: homeProvider,
    sessions: fixture.sessions,
    pageMessages,
    fileList: homeFileList,
    findFiles: () => ["smoke-project"],
  })
  await newLayout(page)

  await page.goto("/")
  await expectAppVisible(page.locator('[data-component="home-hero"]'))
  await page.screenshot({ path: `${SHOTS}/home.png`, fullPage: true })
})

test("new session (new layout): prompt input, model and project controls", async ({ page }) => {
  await mockPrioriCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: homeProvider,
    sessions: fixture.sessions,
    pageMessages,
    fileList: homeFileList,
    findFiles: () => ["smoke-project"],
  })
  await newLayout(page)

  await page.goto("/")
  await expectAppVisible(page.locator('[data-component="home-hero"]'))
  await page.locator('[data-action="home-new-session"]').click()
  await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))
  await expectAppVisible(page.locator('[data-component="session-new-design"]'))
  await page.screenshot({ path: `${SHOTS}/new-session.png` })
})

test("session (legacy layout): timeline, prompt and side panel", async ({ page }) => {
  await mockPrioriCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: fixture.sessions,
    pageMessages,
    messageDelay: 500,
  })
  await legacyLayout(page)

  await page.goto(`/${base64Encode(fixture.directory)}/session/${fixture.targetID}`)
  await expectAppVisible(page.getByRole("heading", { name: fixture.expected.targetTitle }))
  await expectAppVisible(page.getByRole("textbox", { name: "Prompt" }))
  await page.screenshot({ path: `${SHOTS}/session.png`, fullPage: true })
})

test("command palette (new layout): v2 dialog", async ({ page }) => {
  test.setTimeout(90_000)
  await mockPrioriCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: homeProvider,
    sessions: fixture.sessions,
    pageMessages,
    fileList: homeFileList,
    findFiles: () => ["smoke-project"],
  })
  await newLayout(page)

  await page.goto("/")
  await expectAppVisible(page.locator('[data-component="home-hero"]'))
  await page.keyboard.press("Control+k")
  const palette = page.locator('[data-component="dialog-v2"]')
  await expect(palette).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: `${SHOTS}/command-palette.png` })
})
