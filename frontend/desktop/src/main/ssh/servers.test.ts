import { expect, test } from "bun:test"
import { createSshServersController, sshServerIdForAlias, type SshServersController } from "./servers"
import type { SshHostProfile, SshServerConfig } from "@prioricode/app/ssh/types"

type Sidecar = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string | null
  password: string
}

function fakeSidecar(): Sidecar & { triggerExit: (code?: number | null) => void; stops: number } {
  let exitCb: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
  const sidecar = {
    stops: 0,
    listener: {
      stop: () => {
        sidecar.stops++
      },
      onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => {
        exitCb = cb
      },
    },
    url: "http://127.0.0.1:41234",
    username: "prioricode",
    password: "secret-uuid",
    triggerExit: (code: number | null = 1) => exitCb?.(code, null),
  }
  return sidecar
}

function setup(options?: {
  hosts?: SshHostProfile[]
  spawnSidecar?: (alias: string) => Promise<Sidecar>
  remoteExec?: (args: string[], stdin: string, timeoutMs: number) => Promise<{ code: number; output: string }>
}) {
  let persisted: SshServerConfig[] = []
  const hosts = options?.hosts ?? []
  const controller: SshServersController = createSshServersController(
    "0.1.18",
    options?.spawnSidecar ?? (async () => fakeSidecar() as Promise<never>),
    {
      readServers: () => persisted.map((x) => ({ ...x })),
      writeServers: (servers) => (persisted = servers.map((x) => ({ ...x }))),
      readHosts: () => ({ profiles: hosts, files: [{ path: "/home/u/.ssh/config", exists: true, error: null }] }),
      remoteExec: options?.remoteExec ?? (async () => ({ code: 0, output: "" })),
    },
  )
  return {
    controller,
    persistedConfigs: () => persisted,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test("id helper matches ServerConnection ssh key format", () => {
  expect(sshServerIdForAlias("web-prod")).toBe("ssh:web-prod")
})

test("addServer persists config, starts immediately, and rejects duplicates or blank aliases", async () => {
  const started: string[] = []
  const { controller, persistedConfigs } = setup({
    spawnSidecar: async (alias) => {
      started.push(alias)
      return fakeSidecar() as never
    },
  })
  await controller.addServer("web")
  expect(persistedConfigs()).toEqual([{ id: "ssh:web", alias: "web" }])
  expect(started).toEqual(["web"])
  await expect(controller.addServer("web")).rejects.toThrow()
  await expect(controller.addServer("  ")).rejects.toThrow()
  await expect(controller.addServer("two words")).rejects.toThrow()
  await expect(controller.addServer("-oProxyCommand=evil")).rejects.toThrow()
})

test("persisted password is never written to the store", async () => {
  const { controller, persistedConfigs } = setup()
  await controller.addServer("web")
  await flush()
  expect(controller.getState().servers[0]?.runtime.kind).toBe("ready")
  expect(JSON.stringify(persistedConfigs())).not.toContain("secret-uuid")
})

test("stale start attempt cannot clobber a newer attempt", async () => {
  let resolveFirst: ((value: Sidecar) => void) | undefined
  const first = new Promise<Sidecar>((resolve) => (resolveFirst = resolve))
  let calls = 0
  const abandoned = fakeSidecar()
  const { controller } = setup({
    spawnSidecar: async () => {
      calls++
      if (calls === 1) return first
      return fakeSidecar()
    },
  })
  const start = controller.startServer("missing") // no-op for unknown id
  await start
  await controller.addServer("web") // triggers start attempt #1 (slow)
  await controller.stopServer("ssh:web") // invalidates and starts attempt #2? stop only invalidates
  await controller.startServer("ssh:web") // attempt #2 (fast)
  resolveFirst?.(abandoned)
  await flush()
  await flush()
  expect(abandoned.stops).toBe(1) // stale sidecar must be torn down
  expect(controller.getState().servers[0]?.runtime.kind).toBe("ready")
})

test("workspace path persists through add and setWorkspace", async () => {
  const { controller, persistedConfigs } = setup()
  await controller.addServer("web", "/srv/projects")
  expect(persistedConfigs()).toEqual([{ id: "ssh:web", alias: "web", workspace: "/srv/projects" }])
  await controller.setWorkspace("ssh:web", "/srv/other")
  expect(controller.getState().servers[0]?.config.workspace).toBe("/srv/other")
  await controller.setWorkspace("ssh:web", "   ")
  expect(controller.getState().servers[0]?.config.workspace).toBeUndefined()
  expect(persistedConfigs()[0]?.workspace).toBeUndefined()
})

test("missing remote binary auto-installs once and retries the sidecar", async () => {
  let spawns = 0
  const execs: string[] = []
  const { controller } = setup({
    spawnSidecar: async () => {
      spawns++
      if (spawns === 1) {
        const error = new Error("PrioriCode is not installed on web") as Error & { sshBootstrapCode?: string }
        error.sshBootstrapCode = "missing_binary"
        throw error
      }
      return fakeSidecar() as never
    },
    remoteExec: async (args) => {
      execs.push(args.join(" "))
      return { code: 0, output: 'PRIORICODE_SSH_CHECK {"version":"0.1.18","path":"/usr/local/bin/prioricode"}\n' }
    },
  })
  await controller.addServer("web")
  for (let i = 0; i < 10; i++) await flush()
  expect(spawns).toBe(2)
  expect(execs.some((x) => x.includes("curl -fsSL https://prioricode.ai/install"))).toBeTrue()
  expect(controller.getState().servers[0]?.runtime.kind).toBe("ready")
})

test("auto-install runs at most once per server", async () => {
  let spawns = 0
  const execs: string[] = []
  const { controller } = setup({
    spawnSidecar: async () => {
      spawns++
      const error = new Error("PrioriCode is not installed on web") as Error & { sshBootstrapCode?: string }
      error.sshBootstrapCode = "missing_binary"
      throw error
    },
    remoteExec: async (args) => {
      execs.push(args.join(" "))
      return { code: 0, output: 'PRIORICODE_SSH_CHECK {"version":"0.1.18","path":"/usr/local/bin/prioricode"}\n' }
    },
  })
  await controller.addServer("web")
  for (let i = 0; i < 10; i++) await flush()
  await controller.startServer("ssh:web")
  for (let i = 0; i < 10; i++) await flush()
  expect(execs.filter((x) => x.includes("curl -fsSL https://prioricode.ai/install"))).toHaveLength(1)
  expect(controller.getState().servers[0]?.runtime.kind).toBe("failed")
})

test("tunnel exit flips runtime to failed", async () => {
  const side = fakeSidecar()
  const { controller } = setup({ spawnSidecar: async () => side as never })
  await controller.addServer("web")
  await flush()
  expect(controller.getState().servers[0]?.runtime.kind).toBe("ready")
  side.triggerExit(137)
  const runtime = controller.getState().servers[0]?.runtime
  expect(runtime?.kind).toBe("failed")
  if (runtime?.kind === "failed") expect(runtime.message).toContain("web")
})

test("stopServer kills the tunnel and marks stopped; removeServer deletes config", async () => {
  const side = fakeSidecar()
  const { controller, persistedConfigs } = setup({ spawnSidecar: async () => side as never })
  await controller.addServer("web")
  await flush()
  await controller.stopServer("ssh:web")
  expect(side.stops).toBe(1)
  expect(controller.getState().servers[0]?.runtime.kind).toBe("stopped")
  await controller.removeServer("ssh:web")
  expect(persistedConfigs()).toEqual([])
  expect(controller.getState().servers).toEqual([])
})

test("stopAll invalidates attempts and kills every tunnel", async () => {
  const sides = [fakeSidecar(), fakeSidecar()]
  let index = 0
  const { controller } = setup({
    spawnSidecar: async () => sides[index++] as never,
  })
  await controller.addServer("a")
  await controller.addServer("b")
  await flush()
  controller.stopAll()
  expect(sides[0]?.stops).toBe(1)
  expect(sides[1]?.stops).toBe(1)
})

test("refreshHosts pulls parsed profiles from injected reader", async () => {
  const hosts: SshHostProfile[] = [
    { alias: "web", hostname: "web.example.com", user: null, port: null, hasProxy: false, sourceFile: "/x" },
  ]
  const { controller } = setup({ hosts })
  await controller.refreshHosts()
  expect(controller.getState().hosts).toEqual(hosts)
  expect(controller.getState().hostFiles.length).toBe(1)
})

test("installPrioricode runs pinned version, refreshes check, and restarts known server", async () => {
  const execCalls: { args: string[]; stdin: string }[] = []
  const started: string[] = []
  const { controller } = setup({
    hosts: [{ alias: "web", hostname: "web", user: null, port: null, hasProxy: false, sourceFile: "/x" }],
    spawnSidecar: async (alias) => {
      started.push(alias)
      return fakeSidecar() as never
    },
    remoteExec: async (args, stdin) => {
      execCalls.push({ args, stdin })
      return {
        code: 0,
        output: `PRIORICODE_SSH_CHECK {"version":"0.1.18","path":"/home/u/.prioricode/bin/prioricode"}`,
      }
    },
  })
  await controller.addServer("web")
  await flush()
  execCalls.length = 0
  started.length = 0
  await controller.installPrioricode("web")
  expect(execCalls[0]?.args.join(" ")).toContain("curl -fsSL https://prioricode.ai/install")
  expect(execCalls[0]?.args.join(" ")).toContain("--version '0.1.18'")
  expect(controller.getState().prioricodeChecks.web?.matchesDesktop).toBeTrue()
  expect(started).toEqual(["web"])
})

test("initialize starts every persisted server and refreshes hosts", async () => {
  const started: string[] = []
  let persisted: SshServerConfig[] = [{ id: "ssh:web", alias: "web" }]
  const controller = createSshServersController(
    "0.1.18",
    async (alias) => {
      started.push(alias)
      return fakeSidecar() as never
    },
    {
      readServers: () => persisted.map((x) => ({ ...x })),
      writeServers: (servers) => (persisted = servers),
      readHosts: () => ({ profiles: [], files: [] }),
      remoteExec: async () => ({ code: 0, output: "" }),
    },
  )
  await controller.initialize()
  await flush()
  expect(started).toEqual(["web"])
})
