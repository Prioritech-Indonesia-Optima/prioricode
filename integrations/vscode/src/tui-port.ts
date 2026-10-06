import os from "os"
import path from "path"

export interface TuiPort {
  port: number
  pid: number
}

export function tuiStateDirectory(
  env: Record<string, string | undefined> = process.env,
  homedir: () => string = os.homedir,
): string {
  const xdg = env["XDG_STATE_HOME"]
  return path.join(xdg || path.join(homedir(), ".local", "state"), "prioricode")
}

export function parseTuiPort(text: string): TuiPort | undefined {
  try {
    const value = JSON.parse(text) as { port?: unknown; pid?: unknown }
    if (
      typeof value?.port === "number" &&
      Number.isInteger(value.port) &&
      value.port > 0 &&
      value.port < 65536 &&
      typeof value.pid === "number" &&
      Number.isInteger(value.pid)
    ) {
      return { port: value.port, pid: value.pid }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Find the port of a live prioricode TUI session from the state file the
 * worker writes. Any HTTP answer proves a server is listening (dev builds
 * answer 500 on /app), so only connection failures count as dead.
 */
export async function discoverTuiPort(deps: {
  readFile: (file: string) => Promise<string>
  stateDirectory: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<number | undefined> {
  try {
    const parsed = parseTuiPort(await deps.readFile(path.join(deps.stateDirectory, "tui.json")))
    if (!parsed) return undefined
    const fetchImpl = deps.fetchImpl ?? fetch
    await fetchImpl(`http://127.0.0.1:${parsed.port}/app`, { signal: AbortSignal.timeout(deps.timeoutMs ?? 1500) })
    return parsed.port
  } catch {
    return undefined
  }
}
