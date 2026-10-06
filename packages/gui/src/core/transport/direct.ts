import { createGuiClient, type GuiClient } from "./client"

export interface DirectTarget {
  baseUrl: string
  username?: string
  password?: string
  directory?: string
}

const STORAGE_KEY = "prioricode.gui.directTarget"

export function basicAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

export function readStoredTarget(): DirectTarget | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<DirectTarget>
    if (typeof parsed.baseUrl !== "string") return undefined
    return {
      baseUrl: parsed.baseUrl,
      username: typeof parsed.username === "string" ? parsed.username : undefined,
      password: typeof parsed.password === "string" ? parsed.password : undefined,
      directory: typeof parsed.directory === "string" ? parsed.directory : undefined,
    }
  } catch {
    return undefined
  }
}

export function writeStoredTarget(target: DirectTarget | undefined): void {
  try {
    if (target === undefined) globalThis.localStorage?.removeItem(STORAGE_KEY)
    else globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(target))
  } catch {
    // Storage is unavailable in private contexts; credentials simply stay in memory then.
  }
}

export function createDirectClient(target: DirectTarget): GuiClient {
  const headers: Record<string, string> = {}
  if (target.password !== undefined) {
    headers.authorization = basicAuthorization(target.username ?? "prioricode", target.password)
  }
  return createGuiClient({ baseUrl: target.baseUrl, headers })
}
