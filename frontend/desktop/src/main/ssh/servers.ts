import type {
  SshHostProfile,
  SshJob,
  SshPrioricodeCheck,
  SshServerConfig,
  SshServerItem,
  SshServerRuntime,
  SshServersEvent,
  SshServersState,
} from "@prioricode/app/ssh/types"
import { SSH_SERVERS_KEY } from "../store-keys"
import { getStore } from "../store"
import { nativeT } from "../native-translations"
import { readSshConfigProfiles } from "./config"
import { isValidSshAlias, sshBootstrapCodeOf } from "./errors"
import { checkArgs, checkScript, installArgs, parseCheckMarker } from "./commands"

type RunningSidecar = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string | null
  password: string
}

type SpawnSidecar = (alias: string) => Promise<RunningSidecar>

type RemoteExec = (args: string[], stdin: string, timeoutMs: number) => Promise<{ code: number; output: string }>

type ControllerLogger = {
  log: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type SshServersControllerOptions = {
  logger?: ControllerLogger
  readServers?: () => SshServerConfig[]
  writeServers?: (servers: SshServerConfig[]) => void
  readHosts?: () => { profiles: SshHostProfile[]; files: { path: string; exists: boolean; error: string | null }[] }
  remoteExec?: RemoteExec
}

export type SshServersController = ReturnType<typeof createSshServersController>

export function sshServerIdForAlias(alias: string) {
  return `ssh:${alias}`
}

const INSTALL_TIMEOUT_MS = 15 * 60_000
const CHECK_TIMEOUT_MS = 30_000

export function createSshServersController(
  appVersion: string,
  spawnSidecar: SpawnSidecar,
  options?: SshServersControllerOptions,
) {
  let state: SshServersState = initialState()
  const listeners = new Set<(event: SshServersEvent) => void>()
  const sidecars = new Map<string, RunningSidecar>()
  const startAttempts = new Map<string, number>()
  const autoInstalled = new Set<string>()
  let jobAbort: AbortController | undefined
  const logger = options?.logger
  const readServers = options?.readServers ?? readPersistedServers
  const writeServers = options?.writeServers ?? writePersistedServers
  const readHosts = options?.readHosts ?? readSshConfigProfiles
  const remoteExec = options?.remoteExec ?? defaultRemoteExec

  const emit = () => {
    for (const listener of listeners) listener({ type: "state", state })
  }

  const setState = (next: Partial<SshServersState>) => {
    state = { ...state, ...next }
    emit()
  }

  const updateServer = (id: string, update: (item: SshServerItem) => SshServerItem) => {
    setState({ servers: state.servers.map((item) => (item.config.id === id ? update(item) : item)) })
  }

  const beginJob = (job: SshJob): AbortController => {
    jobAbort?.abort()
    const abort = new AbortController()
    jobAbort = abort
    setState({ job })
    return abort
  }

  const endJob = (abort: AbortController) => {
    if (jobAbort !== abort) return
    jobAbort = undefined
    setState({ job: null })
  }

  const refreshFromStore = () => {
    const persisted = readServers()
    const items: SshServerItem[] = persisted.map((config) => {
      const existing = state.servers.find((item) => item.config.id === config.id)
      return { config, runtime: existing?.runtime ?? { kind: "stopped" } }
    })
    setState({ servers: items })
  }

  const setRuntime = (id: string, runtime: SshServerRuntime) => {
    updateServer(id, (item) => ({ ...item, runtime }))
  }

  const setPrioricodeCheck = (alias: string, check: SshPrioricodeCheck) => {
    setState({ prioricodeChecks: { ...state.prioricodeChecks, [alias]: check } })
  }

  const checkPrioricode = async (alias: string): Promise<SshPrioricodeCheck> => {
    try {
      const result = await remoteExec(checkArgs(alias), checkScript(), CHECK_TIMEOUT_MS)
      const parsed = parseCheckMarker(result.output)
      if ("code" in parsed) {
        return {
          alias,
          resolvedPath: null,
          version: null,
          expectedVersion: appVersion,
          matchesDesktop: null,
          error:
            parsed.code === "missing_binary"
              ? nativeT("desktop.ssh.error.prioricodeNotInstalled", { host: alias })
              : nativeT("desktop.ssh.error.bootstrapFailed", { host: alias, code: parsed.code }),
        }
      }
      return {
        alias,
        resolvedPath: parsed.path,
        version: parsed.version || null,
        expectedVersion: appVersion,
        matchesDesktop: parsed.version === appVersion,
        error: null,
      }
    } catch (error) {
      return {
        alias,
        resolvedPath: null,
        version: null,
        expectedVersion: appVersion,
        matchesDesktop: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const refreshPrioricodeCheckBackground = (id: string, alias: string) => {
    void checkPrioricode(alias)
      .then((check) => {
        if (!state.servers.some((item) => item.config.id === id && item.config.alias === alias)) return
        setPrioricodeCheck(alias, check)
      })
      .catch((error) => {
        logger?.error("ssh prioricode check failed", { id, alias, message: String(error) })
      })
  }

  const nextStartAttempt = (id: string) => {
    const next = (startAttempts.get(id) ?? 0) + 1
    startAttempts.set(id, next)
    return next
  }

  const invalidateStartAttempt = (id: string) => {
    startAttempts.set(id, (startAttempts.get(id) ?? 0) + 1)
  }

  const isCurrentStartAttempt = (id: string, attempt: number) => {
    return startAttempts.get(id) === attempt && state.servers.some((item) => item.config.id === id)
  }

  const failStart = (id: string, attempt: number, alias: string, error: unknown, note: string) => {
    if (!isCurrentStartAttempt(id, attempt)) return
    const message = error instanceof Error ? error.message : String(error)
    setRuntime(id, { kind: "failed", message })
    logger?.error(note, { id, alias, message })
  }

  const startSidecarWithAutoInstall = async (id: string, alias: string, attempt: number) => {
    try {
      return await spawnSidecar(alias)
    } catch (error) {
      if (
        sshBootstrapCodeOf(error) !== "missing_binary" ||
        autoInstalled.has(id) ||
        !isCurrentStartAttempt(id, attempt)
      ) {
        failStart(id, attempt, alias, error, "ssh sidecar failed to start")
        return null
      }
      autoInstalled.add(id)
      logger?.log("ssh prioricode binary missing on remote; auto-installing", { id, alias })
      let installed = false
      try {
        const result = await remoteExec(installArgs(alias, appVersion), "", INSTALL_TIMEOUT_MS)
        if (result.code === 0) {
          const check = await checkPrioricode(alias)
          setPrioricodeCheck(alias, check)
          installed = check.version !== null
        }
      } catch (installError) {
        logger?.error("ssh auto-install failed", { id, alias, message: String(installError) })
      }
      if (!isCurrentStartAttempt(id, attempt)) return null
      if (!installed) {
        failStart(id, attempt, alias, error, "ssh sidecar failed to start")
        return null
      }
      try {
        return await spawnSidecar(alias)
      } catch (retryError) {
        failStart(id, attempt, alias, retryError, "ssh sidecar failed to start after auto-install")
        return null
      }
    }
  }

  const startServer = async (id: string) => {
    const item = state.servers.find((x) => x.config.id === id)
    if (!item) return
    const attempt = nextStartAttempt(id)
    await stopServerInternal(id)
    if (!isCurrentStartAttempt(id, attempt)) return
    setRuntime(id, { kind: "starting" })
    logger?.log("ssh sidecar starting", { id, alias: item.config.alias })
    const sidecar = await startSidecarWithAutoInstall(id, item.config.alias, attempt)
    if (!sidecar) return
    if (!isCurrentStartAttempt(id, attempt)) {
      try {
        sidecar.listener.stop()
      } catch {
        // ignore stop errors for stale sidecars
      }
      return
    }
    sidecars.set(id, sidecar)
    setRuntime(id, {
      kind: "ready",
      url: sidecar.url,
      username: sidecar.username,
      password: sidecar.password,
    })
    sidecar.listener.onExit((code, signal) => {
      if (sidecars.get(id) !== sidecar) return
      sidecars.delete(id)
      setRuntime(id, {
        kind: "failed",
        message: nativeT("desktop.ssh.error.serverExited", {
          host: item.config.alias,
          code: code ?? "null",
          signal: signal ?? "null",
        }),
      })
      logger?.error("ssh sidecar exited", { id, alias: item.config.alias, code, signal })
    })
    refreshPrioricodeCheckBackground(id, item.config.alias)
    logger?.log("ssh sidecar ready", { id, alias: item.config.alias, url: sidecar.url })
  }

  const stopServerInternal = async (id: string) => {
    const existing = sidecars.get(id)
    if (!existing) return
    sidecars.delete(id)
    try {
      existing.listener.stop()
    } catch {
      // ignore stop errors
    }
  }

  const runJob = async <T>(job: SshJob, runner: (abort: AbortController) => Promise<T>) => {
    const abort = beginJob(job)
    try {
      const value = await runner(abort)
      endJob(abort)
      return value
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        endJob(abort)
        return undefined
      }
      const err = error instanceof Error ? error : new Error(String(error))
      endJob(abort)
      throw err
    }
  }

  const refreshHostsInternal = async () => {
    const read = readHosts()
    setState({ hosts: read.profiles, hostFiles: read.files })
  }

  return {
    getState() {
      return state
    },
    subscribe(listener: (event: SshServersEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async initialize() {
      refreshFromStore()
      void refreshHostsInternal().catch((error) => logger?.error("ssh hosts refresh failed", String(error)))
      for (const item of state.servers) void startServer(item.config.id)
    },

    async refreshHosts() {
      await runJob({ kind: "hosts", startedAt: Date.now() }, async () => {
        await refreshHostsInternal()
      })
    },

    async addServer(alias: string, workspace?: string): Promise<SshServerConfig> {
      const clean = alias.trim()
      if (!isValidSshAlias(clean)) throw new Error(nativeT("desktop.ssh.error.invalidAlias"))
      const id = sshServerIdForAlias(clean)
      if (state.servers.some((item) => item.config.id === id)) {
        throw new Error(nativeT("desktop.ssh.error.alreadyAdded", { host: clean }))
      }
      const config: SshServerConfig = { id, alias: clean, workspace: normalizeWorkspace(workspace) }
      writeServers([...readServers(), config])
      setState({ servers: [...state.servers, { config, runtime: { kind: "starting" } }] })
      void startServer(id)
      void checkPrioricode(clean).then((check) => {
        if (!state.servers.some((item) => item.config.id === id)) return
        setPrioricodeCheck(clean, check)
      })
      return config
    },

    async setWorkspace(id: string, workspace: string) {
      const clean = normalizeWorkspace(workspace)
      const next = readServers().map((item) => (item.id === id ? { ...item, workspace: clean } : item))
      writeServers(next)
      updateServer(id, (item) => ({ ...item, config: { ...item.config, workspace: clean } }))
    },

    async removeServer(id: string) {
      invalidateStartAttempt(id)
      await stopServerInternal(id)
      const remaining = readServers().filter((item) => item.id !== id)
      writeServers(remaining)
      setState({
        servers: state.servers.filter((item) => item.config.id !== id),
      })
    },

    startServer,

    async stopServer(id: string) {
      invalidateStartAttempt(id)
      await stopServerInternal(id)
      if (state.servers.some((item) => item.config.id === id)) setRuntime(id, { kind: "stopped" })
    },

    async installPrioricode(alias: string) {
      await runJob({ kind: "install-prioricode", alias, startedAt: Date.now() }, async () => {
        const result = await remoteExec(installArgs(alias, appVersion), "", INSTALL_TIMEOUT_MS)
        if (result.code !== 0) {
          throw new Error(nativeT("desktop.ssh.error.installPrioricode", { host: alias }))
        }
        const check = await checkPrioricode(alias)
        setPrioricodeCheck(alias, check)
        if (check.version !== null && check.matchesDesktop !== true) {
          throw new Error(
            nativeT("desktop.ssh.error.updateVersion", {
              host: alias,
              installed: check.version ?? nativeT("desktop.ssh.error.noVersion"),
              expected: appVersion,
            }),
          )
        }
        const id = state.servers.find((item) => item.config.alias === alias)?.config.id
        if (id) await startServer(id)
      })
    },

    stopAll() {
      for (const item of state.servers) invalidateStartAttempt(item.config.id)
      for (const existing of sidecars.values()) {
        try {
          existing.listener.stop()
        } catch {
          // ignore
        }
      }
      sidecars.clear()
    },
  }
}

function initialState(): SshServersState {
  return { hosts: [], hostFiles: [], prioricodeChecks: {}, servers: [], job: null }
}

function readPersistedServers(): SshServerConfig[] {
  const store = getStore()
  const existing = store.get(SSH_SERVERS_KEY)
  if (existing && typeof existing === "object") {
    const record = existing as { servers?: unknown }
    const list = Array.isArray(record.servers) ? record.servers : []
    return list.flatMap(normalizePersistedServer)
  }
  return []
}

function writePersistedServers(servers: SshServerConfig[]) {
  getStore().set(SSH_SERVERS_KEY, { servers })
}

function normalizeWorkspace(value: string | undefined) {
  if (typeof value !== "string") return undefined
  const clean = value.trim()
  return clean.length > 0 ? clean : undefined
}

function normalizePersistedServer(value: unknown): SshServerConfig[] {
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  const alias = typeof record.alias === "string" && record.alias.length > 0 ? record.alias : null
  if (!alias) return []
  const id = typeof record.id === "string" && record.id.length > 0 ? record.id : sshServerIdForAlias(alias)
  return [
    { id, alias, workspace: normalizeWorkspace(typeof record.workspace === "string" ? record.workspace : undefined) },
  ]
}

async function defaultRemoteExec(
  args: string[],
  stdin: string,
  timeoutMs: number,
): Promise<{ code: number; output: string }> {
  const { spawn } = await import("node:child_process")
  const { createAskpassSession, requestAuthPrompt } = await import("./askpass")
  const askpass = await createAskpassSession(requestAuthPrompt)
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("ssh", args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, ...askpass.env },
      })
      if (stdin) child.stdin.end(stdin)
      else child.stdin.end()
      let output = ""
      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (chunk: string) => (output += chunk))
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk: string) => (output += chunk))
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(`ssh timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      child.once("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once("exit", (code) => {
        clearTimeout(timer)
        resolve({ code: code ?? -1, output })
      })
    })
  } finally {
    await askpass.dispose()
  }
}
