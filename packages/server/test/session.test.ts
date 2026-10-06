import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Context } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const context = Context.empty() as Context.Context<unknown>

let directory: string
let server: ReturnType<Awaited<typeof import("../src/routes")>["webHandler"]>

const request = (route: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  headers.set("x-prioricode-directory", directory)
  return server.handler(new Request(`http://prioricode.test${route}`, { ...init, headers }), context)
}

const body = (input: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(input),
})

const payload = async <A>(response: Response) => (await response.json()) as A

beforeAll(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "prioricode-server-session-")))
  server = (await import("../src/routes")).webHandler()
}, 120_000)

afterAll(async () => {
  await server?.dispose()
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

describe("V2 session HTTP surface", () => {
  test("health responds without location headers", async () => {
    const response = await server.handler(new Request("http://prioricode.test/api/health"), context)
    expect(response.status).toBe(200)
    expect(await payload<{ healthy: boolean }>(response)).toEqual({ healthy: true })
  })

  test("openapi advertises the standardized busy wire error", async () => {
    const first = await server.handler(new Request("http://prioricode.test/openapi.json"), context)
    expect(first.status).toBe(200)
    const document = (await first.json()) as {
      paths: Record<string, { post?: { responses: Record<string, unknown> } }>
    }
    expect(JSON.stringify(document)).toContain("SessionBusyError")
    for (const route of ["/api/session/{sessionID}/compact", "/api/session/{sessionID}/wait"])
      expect(Object.keys(document.paths[route]?.post?.responses ?? {})).toContain("409")
  })

  test("creates, reads, switches, admits prompts, and interrupts a session", async () => {
    const created = await request("/api/session", body({ location: { directory } }))
    expect(created.status).toBe(200)
    const session = (await payload<{ data: { id: string; agent?: string } }>(created)).data
    expect(session.id.startsWith("ses_")).toBe(true)

    const missing = await request("/api/session/ses_does_not_exist_00000")
    expect(missing.status).toBe(404)
    expect((await payload<{ _tag: string }>(missing))._tag).toBe("SessionNotFoundError")

    const fetched = await request(`/api/session/${session.id}`)
    expect(fetched.status).toBe(200)

    const switched = await request(`/api/session/${session.id}/agent`, body({ agent: "plan" }))
    expect(switched.status).toBe(204)
    const afterSwitch = await request(`/api/session/${session.id}`)
    expect((await payload<{ data: { agent?: string } }>(afterSwitch)).data.agent).toBe("plan")

    const promptID = `msg_srv_${process.pid}_${Date.now().toString(36)}`
    const prompt = await request(
      `/api/session/${session.id}/prompt`,
      body({ id: promptID, prompt: { text: "hello" }, delivery: "queue", resume: false }),
    )
    expect(prompt.status).toBe(200)
    await prompt.json()

    const conflict = await request(
      `/api/session/${session.id}/prompt`,
      body({ id: promptID, prompt: { text: "different" }, delivery: "queue", resume: false }),
    )
    expect(conflict.status).toBe(409)
    await conflict.json()

    const active = await request("/api/session/active")
    expect(active.status).toBe(200)
    expect((await payload<{ data: Record<string, unknown> }>(active)).data).toEqual({})

    const interrupted = await request(`/api/session/${session.id}/interrupt`, { method: "POST" })
    expect(interrupted.status).toBe(204)
  })

  test("idle-only operations answer 503 when unimplemented and 409 once busy semantics apply", async () => {
    const created = await request("/api/session", body({ location: { directory } }))
    const session = (await payload<{ data: { id: string } }>(created)).data

    const wait = await request(`/api/session/${session.id}/wait`, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    })
    expect(wait.status).toBe(503)
    expect((await payload<{ _tag: string }>(wait))._tag).toBe("ServiceUnavailableError")

    const compact = await request(`/api/session/${session.id}/compact`, body({}))
    expect(compact.status).toBe(204)
    const anchored = await request(`/api/session/${session.id}/compact`, body({ anchor: "msg_missing_anchor_test" }))
    expect(anchored.status).toBe(404)
    expect((await payload<{ _tag: string }>(anchored))._tag).toBe("MessageNotFoundError")

    const commit = await request(`/api/session/${session.id}/revert/commit`, { method: "POST" })
    expect(commit.status).toBe(204)

    const stage = await request(
      `/api/session/${session.id}/revert/stage`,
      body({ messageID: "msg_missing_boundary_server_test" }),
    )
    expect(stage.status).toBe(404)
    expect((await payload<{ _tag: string }>(stage))._tag).toBe("MessageNotFoundError")
  })
})
