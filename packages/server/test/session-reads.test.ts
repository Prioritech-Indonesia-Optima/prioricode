import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Context } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const context = Context.empty() as Context.Context<unknown>

let directory: string
let server: ReturnType<typeof import("../src/routes").webHandler>

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

beforeAll(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "prioricode-server-read-")))
  server = (await import("../src/routes")).webHandler()
}, 120_000)

afterAll(async () => {
  await server?.dispose()
  if (directory) await fs.rm(directory, { recursive: true, force: true })
}, 30_000)

const createSession = async () => {
  const created = await request("/api/session", body({ location: { directory } }))
  return ((await created.json()) as { data: { id: string } }).data.id
}

describe("V2 session read surfaces", () => {
  test("messages, questions, and permissions are empty for a fresh session", async () => {
    const sessionID = await createSession()
    for (const route of [
      `/api/session/${sessionID}/message`,
      `/api/session/${sessionID}/question`,
      `/api/session/${sessionID}/permission`,
    ]) {
      const response = await request(route)
      expect(response.status, route).toBe(200)
      expect(((await response.json()) as { data: unknown }).data, route).toEqual([])
    }
  })

  test("unknown sessions and requests fail with the declared wire errors", async () => {
    const missing = await request("/api/session/ses_does_not_exist_00001/message")
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { _tag: string })._tag).toBe("SessionNotFoundError")

    const sessionID = await createSession()
    const reply = await request(
      `/api/session/${sessionID}/question/que_missing_00000000/reply`,
      body({ answers: [["Yes"]] }),
    )
    expect(reply.status).toBe(404)
    expect(((await reply.json()) as { _tag: string })._tag).toBe("QuestionNotFoundError")

    const permission = await request(`/api/session/${sessionID}/permission/per_missing_0000000`)
    expect(permission.status).toBe(404)
    expect(((await permission.json()) as { _tag: string })._tag).toBe("PermissionNotFoundError")
  })

  test("agent and global request lists answer without session state", async () => {
    const agents = await request("/api/agent")
    expect(agents.status).toBe(200)
    expect(Array.isArray(((await agents.json()) as { data: unknown }).data)).toBe(true)

    const questions = await request("/api/question/request")
    expect(questions.status).toBe(200)
    expect(((await questions.json()) as { data: unknown[] }).data).toEqual([])

    const permissions = await request("/api/permission/request")
    expect(permissions.status).toBe(200)
    expect(((await permissions.json()) as { data: unknown[] }).data).toEqual([])
  })
})
