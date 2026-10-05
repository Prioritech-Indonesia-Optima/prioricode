/**
 * Browser end-to-end for the PrioriCode GUI: real Chromium against the Vite dev
 * server, talking to the live prioricode daemon through the /api proxy.
 * Covers: boot + auth settings, sessions sidebar, transcript restore via
 * durable-history replay, prompt send + streamed error surfacing, model picker,
 * and the embedded xterm terminal over a ticketed PTY WebSocket.
 *
 * Usage: bun run script/e2e-browser.mjs   (needs `bun run dev` and a running daemon)
 */
// Resolved via the workspace copy because packages/gui does not depend on playwright itself.
const { chromium } = await import(
  /* @vite-ignore */ new URL("../../../packages/app/node_modules/@playwright/test/index.mjs", import.meta.url).href
)
import { mkdirSync, readFileSync } from "fs"
import { homedir } from "os"

const stateDir = process.env["XDG_STATE_HOME"] ?? `${homedir()}/.local/state`
const guiUrl = process.env["GUI_E2E_URL"] ?? "http://localhost:5273/"
const password = readFileSync(`${stateDir}/prioricode/password`, "utf8").trim()
const shotDir = "/tmp/gui-e2e"
mkdirSync(shotDir, { recursive: true })

const step = async (name, fn) => {
  process.stdout.write(`• ${name} ... `)
  try {
    await fn()
    console.log("ok")
  } catch (error) {
    console.log(`FAIL\n  ${String(error).split("\n")[0]}`)
    await page.screenshot({ path: `${shotDir}/fail-${name.replace(/\W+/g, "-")}.png`, fullPage: true }).catch(() => {})
    await browser.close()
    process.exit(1)
  }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1180, height: 800 } })
const pageErrors = []
page.on("pageerror", (error) => pageErrors.push(String(error)))

await step("boot + settings + connect", async () => {
  await page.goto(guiUrl, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Server" }).waitFor({ timeout: 20_000 })
  await page.getByRole("button", { name: "Server" }).click()
  await page.getByPlaceholder("/absolute/path/to/your/project").waitFor({ timeout: 10_000 })
  await page.getByPlaceholder("/absolute/path/to/your/project").fill("/home/aiadmin/work/prioricode")
  await page.locator('input[type="password"]').last().fill(password)
  await page.getByRole("button", { name: "Save & connect" }).click()
  await page.getByText("Connected").waitFor({ timeout: 20_000 })
})

await step("sessions sidebar lists real daemon sessions", async () => {
  await page.locator("aside button").filter({ hasText: /New session - \d{4}/ }).first().waitFor({ timeout: 15_000 })
})

const marker = `GUI-E2E-${Math.random().toString(36).slice(2, 7)}`

await step("send prompt -> optimistic bubble + streamed turn result", async () => {
  await page.getByRole("button", { name: "New", exact: true }).click()
  const composer = page.getByPlaceholder(/Ask prioricode/)
  await composer.click()
  await composer.fill(`Reply with exactly this single line and nothing else: ${marker}`)
  await composer.press("Enter")
  await page.getByText(marker, { exact: false }).first().waitFor({ timeout: 10_000 })
  // Either the assistant answers (provider healthy) or the turn fails loudly (provider key expired) —
  // both are rendered from real streamed events; the wire itself must complete either way.
  const settled = await Promise.race([
    page.getByText(marker, { exact: false }).nth(1).waitFor({ timeout: 90_000 }).then(() => "answered"),
    page.locator("text=/Provider request failed|401/").first().waitFor({ timeout: 90_000 }).then(() => "provider-error"),
  ]).catch(() => "timeout")
  if (settled !== "answered" && settled !== "provider-error") throw new Error("turn never settled")
  console.log(`  [stream settled via ${settled}]`)
})

await step("session restore from durable history (reload + sidebar reselect)", async () => {
  await page.getByRole("button", { name: "New", exact: true }).click()
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Server" }).waitFor({ timeout: 20_000 })
  const row = page.locator("aside button").filter({ hasText: /New session - \d{4}/ }).first()
  await row.waitFor({ timeout: 20_000 })
  await row.click()
  await page.getByText(`Reply with exactly this single line and nothing else: ${marker}`).first().waitFor({ timeout: 20_000 })
})

await step("model picker shows catalog", async () => {
  const trigger = page.locator("header button").nth(2)
  await trigger.click()
  const items = page.locator('[role="menuitem"]')
  if ((await items.count().catch(() => 0)) === 0) {
    await page.waitForTimeout(400)
    await trigger.click()
  }
  await items.filter({ hasText: /prioritech-llm|qwen|claude|gpt/i }).first().waitFor({ timeout: 8_000 })
  await page.keyboard.press("Escape")
})

await step("embedded terminal: PTY round-trip", async () => {
  await page.getByRole("button", { name: "Terminal", exact: true }).click()
  await page.getByText("Terminal attached").waitFor({ timeout: 20_000 })
  await page.locator(".xterm").click()
  await page.keyboard.type("echo E2E_$((21*2))\n")
  await page.locator(".xterm").filter({ hasText: "E2E_42" }).waitFor({ timeout: 20_000 })
})

await step("no uncaught page errors", async () => {
  if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.slice(0, 3).join(" | ")}`)
})

await page.screenshot({ path: `${shotDir}/final.png`, fullPage: true })
console.log(`BROWSER E2E PASS — screenshots in ${shotDir}/final.png (marker ${marker})`)
await browser.close()
