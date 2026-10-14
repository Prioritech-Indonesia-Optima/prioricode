import { base64Encode } from "@prioricode/core/util/encode"
import { expect, test, type Page, type Route } from "@playwright/test"

const serverA = "http://127.0.0.1:4096"
const sshServer = "ssh:myhost"
const sessionID = "ses_remote"

// Regression: opening a remote (SSH) session whose server is not connected yet
// (e.g. right after a desktop restart) must show a "connecting" state instead of
// crashing the app or silently falling back to another server and reporting the
// session as missing.
test("remote session shows a connecting state while the target server is not connected", async ({ page }) => {
  await configureServers(page)
  await mockDefaultServer(page)

  await page.goto(`/server/${base64Encode(sshServer)}/session/${sessionID}`)

  const fallback = page.locator('[data-component="server-route-fallback"]')
  await expect(fallback).toBeVisible()
  await expect(fallback.getByText(/Connecting to myhost/)).toBeVisible()
  await expect(page.getByText("Invalid server route")).toHaveCount(0)
  await expect(page.getByText("This session cannot be found")).toHaveCount(0)
})

// Regression: an unresolvable server key in the URL must render a contained
// fallback rather than throwing "Invalid server route" and taking down the app.
test("remote session with an unresolvable server key does not crash the app", async ({ page }) => {
  await configureServers(page)
  await mockDefaultServer(page)

  await page.goto(`/server/not-base64/session/${sessionID}`)

  const fallback = page.locator('[data-component="server-route-fallback"]')
  await expect(fallback).toBeVisible()
  await expect(fallback.getByText("This server route is invalid")).toBeVisible()
  await expect(page.getByText("Invalid server route")).toHaveCount(0)
})

async function configureServers(page: Page) {
  await page.addInitScript(
    ({ serverA }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("prioricode.global.dat:server", JSON.stringify({ list: [serverA] }))
      localStorage.setItem("prioricode.window.browser.dat:tabs", JSON.stringify([]))
    },
    { serverA },
  )
}

async function mockDefaultServer(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.port !== "4096") return route.fallback()
    const location = { directory: "/home/user" }
    if (url.pathname === "/global/health") return json(route, { healthy: true })
    if (url.pathname === "/api/health") return json(route, { healthy: true, version: "2.0.0", pid: 1 })
    if (url.pathname === "/global/event" || url.pathname === "/event" || url.pathname === "/api/event")
      return sse(route)
    if (url.pathname === "/path" || url.pathname === "/api/path")
      return json(route, {
        state: "/home/user",
        config: "/home/user",
        worktree: "/home/user",
        directory: "/home/user",
        home: "/home/user",
      })
    if (url.pathname === "/project" || url.pathname === "/api/project") return json(route, [])
    if (url.pathname === "/project/current" || url.pathname === "/api/project/current")
      return json(route, { id: "project", directory: "/home/user" })
    if (url.pathname === "/provider" || url.pathname === "/api/provider")
      return json(route, { all: [], connected: [], default: {} })
    if (url.pathname === "/api/session") return json(route, { data: [], cursor: {} })
    if (url.pathname === "/api/session/active") return json(route, { data: {} })
    if (url.pathname === "/agent" || url.pathname === "/api/agent") return json(route, { data: [] })
    if (url.pathname === "/api/command" || url.pathname === "/api/mcp") return json(route, { location, data: [] })
    if (url.pathname === "/api/mcp/resource") return json(route, { location, data: { resources: [], templates: [] } })
    if (url.pathname === "/api/reference") return json(route, { location, data: [] })
    if (url.pathname === "/api/vcs" || url.pathname === "/api/vcs/status") return json(route, { location, data: [] })
    if (url.pathname === "/api/pty/shells") return json(route, { location, data: [] })
    if (url.pathname === "/api/permission/request" || url.pathname === "/api/question/request")
      return json(route, { location, data: [] })
    if (
      [
        "/global/config",
        "/config",
        "/provider/auth",
        "/mcp",
        "/skill",
        "/command",
        "/lsp",
        "/formatter",
        "/question",
        "/vcs/diff",
      ].includes(url.pathname)
    )
      return json(route, {})
    return json(route, {})
  })
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body ?? null),
  })
}

function sse(route: Route) {
  return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ok\n\n" })
}
