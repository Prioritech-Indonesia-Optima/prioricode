import type { OutgoingAttachment, PermissionReply } from "./types"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(`HTTP ${status} for ${path}${body ? `: ${body.slice(0, 300)}` : ""}`)
    this.name = "ApiError"
  }
}

export interface PromptFile {
  uri: string
  name?: string
}

export interface ClientOptions {
  url: string
  username: string
  password?: string
  fetchImpl?: typeof fetch
}

export function attachmentFile(attachment: OutgoingAttachment): PromptFile {
  return {
    uri: `data:${attachment.mime};base64,${attachment.dataBase64}`,
    name: attachment.name,
  }
}

export function createClient(options: ClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (options.password !== undefined) {
    headers.authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`
  }

  async function request<T>(method: string, route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetchImpl(`${options.url}${route}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new ApiError(response.status, text, route)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  const sessionPath = (sessionID: string) => `/api/session/${encodeURIComponent(sessionID)}`

  return {
    async createSession(directory: string): Promise<string> {
      const result = await request<{ data: { id: string } }>("POST", "/api/session", { location: { directory } })
      return result.data.id
    },
    async prompt(input: {
      sessionID: string
      messageID?: string
      text: string
      files?: PromptFile[]
      delivery?: "steer" | "queue"
    }): Promise<void> {
      await request(
        "POST",
        `${sessionPath(input.sessionID)}/prompt`,
        {
          ...(input.messageID === undefined ? {} : { id: input.messageID }),
          prompt: { text: input.text, ...(input.files && input.files.length > 0 ? { files: input.files } : {}) },
          ...(input.delivery === undefined ? {} : { delivery: input.delivery }),
        },
      )
    },
    async interrupt(sessionID: string): Promise<void> {
      await request("POST", `${sessionPath(sessionID)}/interrupt`)
    },
    async listPermissions(sessionID: string): Promise<{ id: string; action: string; resources: string[] }[]> {
      const result = await request<{ data: { id: string; action: string; resources: string[] }[] }>(
        "GET",
        `${sessionPath(sessionID)}/permission`,
      )
      return result.data
    },
    async replyPermission(sessionID: string, requestID: string, reply: PermissionReply): Promise<void> {
      await request("POST", `${sessionPath(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`, { reply })
    },
    async listQuestions(sessionID: string): Promise<Record<string, unknown>[]> {
      const result = await request<{ data: Record<string, unknown>[] }>("GET", `${sessionPath(sessionID)}/question`)
      return result.data
    },
    async replyQuestion(sessionID: string, requestID: string, answers: string[][]): Promise<void> {
      await request("POST", `${sessionPath(sessionID)}/question/${encodeURIComponent(requestID)}/reply`, { answers })
    },
    async rejectQuestion(sessionID: string, requestID: string): Promise<void> {
      await request("POST", `${sessionPath(sessionID)}/question/${encodeURIComponent(requestID)}/reject`)
    },
    async openStream(route: string, signal: AbortSignal): Promise<Response> {
      const response = await fetchImpl(`${options.url}${route}`, {
        method: "GET",
        headers: { ...headers, accept: "text/event-stream" },
        signal,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ApiError(response.status, text, route)
      }
      if (!response.body) throw new ApiError(0, "response has no body", route)
      return response
    },
  }
}

export type ChatClient = ReturnType<typeof createClient>
