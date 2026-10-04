import path from "path"

export interface ServerInfo {
  url: string
  username: string
  password?: string
  version?: string
}

export type DiscoveryResult =
  | { ok: true; server: ServerInfo }
  | { ok: false; reason: "auth-mismatch" | "offline" | "no-cli"; detail?: string }

export type HealthOutcome = "ok" | "unauthorized" | "unreachable"

export interface Registration {
  id?: string
  version?: string
  url: string
  pid?: number
}

export interface DiscoveryDeps {
  env: Record<string, string | undefined>
  homedir: () => string
  readFile: (path: string) => Promise<string>
  probe: (server: ServerInfo) => Promise<HealthOutcome>
  startDaemon?: () => Promise<boolean>
  log?: (message: string) => void
}

export const DEFAULT_USERNAME = "prioricode"

export function stateDirectory(deps: Pick<DiscoveryDeps, "env" | "homedir">): string {
  const xdg = deps.env["XDG_STATE_HOME"]
  const base = xdg || path.join(deps.homedir(), ".local", "state")
  return path.join(base, "prioricode")
}

export function normalizeServerUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.hostname === "0.0.0.0" || url.hostname === "::" || url.hostname === "[::]" || url.hostname === "[::1]") {
      url.hostname = "127.0.0.1"
    }
    return url.origin
  } catch {
    return raw.replace(/\/+$/, "")
  }
}

export function parseRegistration(text: string): Registration | undefined {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (typeof value?.url !== "string") return undefined
    return {
      id: typeof value.id === "string" ? value.id : undefined,
      version: typeof value.version === "string" ? value.version : undefined,
      url: value.url,
      pid: typeof value.pid === "number" ? value.pid : undefined,
    }
  } catch {
    return undefined
  }
}

const readOptional = async (readFile: (path: string) => Promise<string>, file: string): Promise<string | undefined> => {
  try {
    return await readFile(file)
  } catch {
    return undefined
  }
}

async function tryRegistered(
  deps: DiscoveryDeps,
): Promise<{ outcome: HealthOutcome; server: ServerInfo } | undefined> {
  const directory = stateDirectory(deps)
  const registrationText = await readOptional(deps.readFile, path.join(directory, "server.json"))
  if (registrationText === undefined) return undefined
  const registration = parseRegistration(registrationText)
  if (!registration) return undefined
  const password = (await readOptional(deps.readFile, path.join(directory, "password")))?.trim()
  const server: ServerInfo = {
    url: normalizeServerUrl(registration.url),
    username: DEFAULT_USERNAME,
    password: password === undefined || password === "" ? undefined : password,
    version: registration.version,
  }
  const outcome = await deps.probe(server)
  deps.log?.(`probe ${server.url}: ${outcome}`)
  return { outcome, server }
}

export async function discover(deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const first = await tryRegistered(deps)
  if (first) {
    if (first.outcome === "ok") return { ok: true, server: first.server }
    if (first.outcome === "unauthorized")
      return { ok: false, reason: "auth-mismatch", detail: `Server at ${first.server.url} rejected the stored password.` }
  }

  if (deps.startDaemon) {
    deps.log?.("attempting to start the prioricode service")
    const started = await deps.startDaemon().catch(() => false)
    if (started) {
      const second = await tryRegistered(deps)
      if (second?.outcome === "ok") return { ok: true, server: second.server }
      if (second?.outcome === "unauthorized")
        return { ok: false, reason: "auth-mismatch", detail: `Server at ${second.server.url} rejected the stored password.` }
    }
  }

  return { ok: false, reason: "offline", detail: first ? `Server at ${first.server.url} is not responding.` : undefined }
}

export async function defaultProbe(fetchImpl: typeof fetch, server: ServerInfo, timeoutMs = 2000): Promise<HealthOutcome> {
  const headers: Record<string, string> = {}
  if (server.password !== undefined) {
    headers.authorization = `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`
  }
  try {
    const response = await fetchImpl(`${server.url}/api/health`, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (response.status === 401 || response.status === 403) return "unauthorized"
    if (!response.ok) return "unreachable"
    const body = (await response.json()) as Record<string, unknown>
    return body?.healthy === true ? "ok" : "unreachable"
  } catch {
    return "unreachable"
  }
}
