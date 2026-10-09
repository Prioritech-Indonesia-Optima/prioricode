export type SshHostProfile = {
  alias: string
  hostname: string | null
  user: string | null
  port: number | null
  hasProxy: boolean
  sourceFile: string
}

export type SshPrioricodeCheck = {
  alias: string
  resolvedPath: string | null
  version: string | null
  expectedVersion: string
  matchesDesktop: boolean | null
  error: string | null
}

export type SshServerConfig = {
  id: string
  alias: string
  workspace?: string
}

export type SshServerRuntime =
  | { kind: "starting" }
  | { kind: "ready"; url: string; username: string | null; password: string | null }
  | { kind: "failed"; message: string }
  | { kind: "stopped" }

export type SshServerItem = {
  config: SshServerConfig
  runtime: SshServerRuntime
}

export type SshJob =
  | { kind: "hosts"; startedAt: number }
  | { kind: "install-prioricode"; alias: string; startedAt: number }

export type SshServersState = {
  hosts: SshHostProfile[]
  hostFiles: { path: string; exists: boolean; error: string | null }[]
  prioricodeChecks: Record<string, SshPrioricodeCheck>
  servers: SshServerItem[]
  job: SshJob | null
}

export type SshServersEvent = { type: "state"; state: SshServersState }

export type SshServersPlatform = {
  getState(): Promise<SshServersState>
  subscribe(cb: (event: SshServersEvent) => void): () => void
  refreshHosts(): Promise<void>
  addServer(alias: string, workspace?: string): Promise<SshServerConfig>
  setWorkspace(id: string, workspace: string): Promise<void>
  removeServer(id: string): Promise<void>
  startServer(id: string): Promise<void>
  stopServer(id: string): Promise<void>
  installPrioricode(alias: string): Promise<void>
}
