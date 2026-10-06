/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { PermissionRequest } from "@prioricode/sdk/v2"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory } from "../fixture/tui-sdk"
import { TestTuiContexts } from "../fixture/tui-environment"
import { ArgsProvider } from "../../src/context/args"
import { KVProvider } from "../../src/context/kv"
import { ToastProvider } from "../../src/ui/toast"
import { RouteProvider } from "../../src/context/route"
import { TuiConfigProvider } from "../../src/config"
import { SDKProvider } from "../../src/context/sdk"
import { ProjectProvider } from "../../src/context/project"
import { ExitProvider } from "../../src/context/exit"
import { SyncProvider, useSync } from "../../src/context/sync"
import { PermissionProvider } from "../../src/context/permission"
import { ThemeProvider } from "../../src/context/theme"
import { LocalProvider } from "../../src/context/local"
import { StatusBar } from "../../src/component/status-bar"

const SESSION = "ses_1"

const session = {
  id: SESSION,
  title: "Status session",
  slug: SESSION,
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  permissionMode: "ask-first",
  time: { created: 0, updated: 0 },
}

const provider = {
  id: "acme",
  models: { "model-1": { limit: { context: 10000 } } },
}

const assistantMessage = {
  id: "msg_1",
  sessionID: SESSION,
  role: "assistant",
  providerID: "acme",
  modelID: "model-1",
  tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, completed: 1 },
}

function permission(id: string): PermissionRequest {
  return {
    id,
    sessionID: SESSION,
    permission: "edit",
    patterns: [],
    metadata: {},
    always: [],
  } as unknown as PermissionRequest
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

async function harness(width: number) {
  const rootDir = await tmpdir()
  const root = rootDir.path
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/session") return jsonResponse([session])
    if (url.pathname === "/config/providers") return jsonResponse({ providers: [provider], default: {} })
    return undefined
  }, events)

  let sync!: ReturnType<typeof useSync>
  function Host() {
    sync = useSync()
    return <StatusBar sessionID={SESSION} permissions={() => sync.data.permission[SESSION] ?? []} />
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <ArgsProvider>
          <KVProvider>
            <ToastProvider>
              <RouteProvider initialRoute={{ type: "session", sessionID: SESSION }}>
                <TuiConfigProvider config={createTuiResolvedConfig({})}>
                  <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
                    <ProjectProvider>
                      <ExitProvider exit={() => {}}>
                        <SyncProvider>
                          <PermissionProvider>
                            <ThemeProvider mode="dark">
                              <LocalProvider>
                                <Host />
                              </LocalProvider>
                            </ThemeProvider>
                          </PermissionProvider>
                        </SyncProvider>
                      </ExitProvider>
                    </ProjectProvider>
                  </SDKProvider>
                </TuiConfigProvider>
              </RouteProvider>
            </ToastProvider>
          </KVProvider>
        </ArgsProvider>
      </TestTuiContexts>
    ),
    { width, height: 8 },
  )

  const start = Date.now()
  while (!sync || sync.status !== "complete") {
    if (Date.now() - start > 5000) throw new Error("sync never completed")
    await app.renderOnce()
    await Bun.sleep(10)
  }
  return { app, sync, events, cleanup: () => rootDir[Symbol.asyncDispose]() }
}

async function settle(app: Awaited<ReturnType<typeof harness>>["app"], needle: string, absent?: string) {
  let frame = ""
  for (let i = 0; i < 100; i++) {
    await app.renderOnce()
    frame = app.captureCharFrame()
    if (frame.includes(needle)) break
    await Bun.sleep(20)
  }
  expect(frame).toContain(needle)
  if (absent !== undefined) expect(frame).not.toContain(absent)
  return frame
}

test("status bar shows dir:branch, permission mode pill, and live context usage", async () => {
  const { app, sync, cleanup } = await harness(120)
  try {
    await settle(app, "ask-first")
    sync.set("message", SESSION, [assistantMessage] as never)
    const frame = await settle(app, "1.5K (15%)")
    expect(frame).toContain("main")
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})

test("pending permission requests surface as a warning count", async () => {
  const { app, events, cleanup } = await harness(120)
  try {
    await settle(app, "ask-first")
    events.emit({
      directory,
      project: "proj_test",
      payload: { id: "evt_1", type: "permission.asked", properties: permission("per_a") },
    } as never)
    await settle(app, "△ 1 permission")
    events.emit({
      directory,
      project: "proj_test",
      payload: { id: "evt_2", type: "permission.asked", properties: permission("per_b") },
    } as never)
    await settle(app, "△ 2 permissions")
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})

test("narrow widths drop the directory but keep the mode pill", async () => {
  const { app, cleanup } = await harness(60)
  try {
    const frame = await settle(app, "ask-first")
    expect(frame).not.toContain("packages/tui")
  } finally {
    app.renderer.destroy()
    await cleanup()
  }
})
