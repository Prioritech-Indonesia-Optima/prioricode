import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { connect } from "node:net"
import { checkHealth } from "../server"
import { pollWslHealth } from "../wsl/startup"
import { nativeT } from "../native-translations"
import { createAskpassSession, requestAuthPrompt } from "./askpass"
import { classifySshFailure, isForeignForwardFailure, isLocalBindFailure } from "./errors"
import {
  bootstrapArgs,
  bootstrapScript,
  parseBootstrapMarker,
  probeArgs,
  stopArgs,
  stopScript,
  tunnelArgs,
  type SshBootstrapResult,
} from "./commands"
import { allocateLoopbackPort } from "../ports"

export type SshSidecar = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string | null
  password: string
  reused: boolean
}

export type SshSidecarOptions = {
  onLine?: (line: { stream: "stdout" | "stderr"; text: string }) => void
  healthTimeoutMs?: number
  bootstrapTimeoutMs?: number
  probeTimeoutMs?: number
  listenerTimeoutMs?: number
  authEnv?: Record<string, string>
  spawn?: typeof spawn
}

export class SshTunnelExitError extends Error {
  constructor(
    message: string,
    readonly output: string,
    readonly code: number | null,
    readonly signal: NodeJS.Signals | null,
  ) {
    super(message)
    this.name = "SshTunnelExitError"
  }
}

export async function spawnSshSidecar(alias: string, options: SshSidecarOptions = {}): Promise<SshSidecar> {
  const username = "prioricode"
  const askpass = await createAskpassSession(requestAuthPrompt)
  const opts: SshSidecarOptions = { ...options, authEnv: { ...process.env, ...askpass.env } as Record<string, string> }
  try {
    return await spawnSshSidecarInner(alias, opts, username)
  } finally {
    await askpass.dispose()
  }
}

async function spawnSshSidecarInner(alias: string, opts: SshSidecarOptions, username: string): Promise<SshSidecar> {
  await runPreflight(alias, opts)
  const boot = await bootstrap(alias, opts)
  try {
    return await openTunnel(alias, boot, await allocateLoopbackPort(), username, opts)
  } catch (error) {
    // A reused remote server can already be dead, foreign-owned on the port,
    // or mid-shutdown. Recover exactly once by stopping it and bootstrapping fresh.
    if (!boot.reused) throw error
    opts.onLine?.({ stream: "stderr", text: `retrying ${alias} with a fresh remote server` })
    await runRemoteExec(stopArgs(alias), stopScript(), opts)
    const fresh = await bootstrap(alias, opts)
    return openTunnel(alias, fresh, await allocateLoopbackPort(), username, opts)
  }
}

async function bootstrap(alias: string, opts: SshSidecarOptions): Promise<SshBootstrapResult> {
  const boot = await runBootstrap(alias, randomUUID(), opts)
  if ("code" in boot) {
    const error = new Error(bootstrapError(alias, boot.code)) as Error & { sshBootstrapCode?: string }
    error.sshBootstrapCode = boot.code
    throw error
  }
  return boot
}

export function bootstrapError(alias: string, code: string) {
  if (code === "missing_binary") return nativeT("desktop.ssh.error.prioricodeNotInstalled", { host: alias })
  if (code === "busy") return nativeT("desktop.ssh.error.busy", { host: alias })
  if (code.startsWith("insecure_bind"))
    return nativeT("desktop.ssh.error.insecureBind", {
      host: alias,
      address: code.slice("insecure_bind".length).trim(),
    })
  return nativeT("desktop.ssh.error.bootstrapFailed", { host: alias, code })
}

function runPreflight(alias: string, opts: SshSidecarOptions) {
  return new Promise<void>((resolve, reject) => {
    const child = (opts.spawn ?? spawn)("ssh", probeArgs(alias), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: opts.authEnv,
    })
    let output = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => (output += chunk))
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => (output += chunk))
    const timeoutMs = opts.probeTimeoutMs ?? 20_000
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(nativeT("desktop.ssh.error.unreachable", { host: alias })))
    }, timeoutMs)
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(error.code === "ENOENT" ? new Error(nativeT("desktop.ssh.error.sshMissing")) : error)
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(classifySshFailure(output, alias, code)))
    })
  })
}

function runRemoteExec(args: string[], stdinText: string, opts: SshSidecarOptions): Promise<void> {
  return new Promise((resolve) => {
    const child = (opts.spawn ?? spawn)("ssh", args, {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
      env: opts.authEnv,
    })
    child.stdin.end(stdinText)
    const timer = setTimeout(() => {
      child.kill()
      resolve()
    }, 15_000)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    child.once("error", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function openTunnel(
  alias: string,
  boot: SshBootstrapResult,
  localPort: number,
  username: string,
  opts: SshSidecarOptions,
): Promise<SshSidecar> {
  for (let attempt = 0; ; attempt++) {
    const strict = attempt === 0
    try {
      return await spawnTunnel(alias, boot, localPort, username, opts, strict)
    } catch (error) {
      if (error instanceof SshTunnelExitError && isLocalBindFailure(error.output)) {
        throw new Error(nativeT("desktop.ssh.error.localPortBusy", { host: alias, port: localPort }))
      }
      if (strict && error instanceof SshTunnelExitError && isForeignForwardFailure(error.output)) {
        opts.onLine?.({
          stream: "stderr",
          text: `retrying tunnel for ${alias} without ExitOnForwardFailure (unrelated remote forward failed)`,
        })
        continue
      }
      throw error
    }
  }
}

function assertLocalListener(alias: string, localPort: number, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    let timer: ReturnType<typeof setTimeout> | undefined
    const tryOnce = () => {
      const socket = connect({ host: "127.0.0.1", port: localPort })
      const fail = () => {
        socket.destroy()
        if (Date.now() >= deadline) {
          reject(new Error(nativeT("desktop.ssh.error.localPortBusy", { host: alias, port: localPort })))
          return
        }
        timer = setTimeout(tryOnce, 150)
      }
      socket.once("connect", () => {
        if (timer) clearTimeout(timer)
        socket.destroy()
        resolve()
      })
      socket.once("error", fail)
      socket.setTimeout(250, fail)
    }
    tryOnce()
  })
}

async function spawnTunnel(
  alias: string,
  boot: SshBootstrapResult,
  localPort: number,
  username: string,
  opts: SshSidecarOptions,
  strict: boolean,
): Promise<SshSidecar> {
  const child = (opts.spawn ?? spawn)("ssh", tunnelArgs(alias, localPort, boot.port, strict), {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: opts.authEnv,
  })
  const recentOutput: string[] = []
  const emit = (line: { stream: "stdout" | "stderr"; text: string }) => {
    if (!line.text.trim()) return
    recentOutput.push(`[${line.stream}] ${line.text}`)
    if (recentOutput.length > 12) recentOutput.shift()
    opts.onLine?.(line)
  }
  forwardLines(child.stdout, "stdout", emit)
  forwardLines(child.stderr, "stderr", emit)

  const exit = new Promise<never>((_, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) =>
      reject(
        new SshTunnelExitError(
          nativeT("desktop.ssh.error.serverExitedBeforeHealthy", {
            host: alias,
            code: code ?? "null",
            signal: signal ?? "null",
            output: recentOutput.length ? `\n${recentOutput.join("\n")}` : "",
          }),
          recentOutput.join("\n"),
          code,
          signal,
        ),
      ),
    )
  })
  const url = `http://127.0.0.1:${localPort}`
  const startup = new AbortController()
  const health = pollWslHealth(() => checkHealth(url, boot.password), startup.signal)
  const timeoutMs = opts.healthTimeoutMs ?? 30_000
  let timeout: ReturnType<typeof setTimeout>
  const timedOut = new Promise<never>(
    (_, reject) =>
      (timeout = setTimeout(
        () => reject(new Error(nativeT("desktop.ssh.error.healthTimeout", { host: alias, timeout: timeoutMs }))),
        timeoutMs,
      )),
  )

  if (!strict) await assertLocalListener(alias, localPort, opts.listenerTimeoutMs ?? 5_000)
  await Promise.race([health, exit, timedOut])
    .catch((error) => {
      child.kill()
      throw error
    })
    .finally(() => {
      clearTimeout(timeout)
      startup.abort()
    })

  return {
    listener: {
      stop: () => child.kill(),
      onExit: (cb) => child.once("exit", cb),
    },
    url,
    username,
    password: boot.password,
    reused: boot.reused,
  }
}

function runBootstrap(
  alias: string,
  password: string,
  opts: SshSidecarOptions,
): Promise<SshBootstrapResult | { code: string }> {
  const child = (opts.spawn ?? spawn)("ssh", bootstrapArgs(alias), {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: opts.authEnv,
  })
  child.stdin.end(bootstrapScript(password))
  let stdout = ""
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk
  })
  const collect: string[] = []
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    collect.push(chunk)
    opts.onLine?.({ stream: "stderr", text: chunk })
  })
  const timeoutMs = opts.bootstrapTimeoutMs ?? 90_000
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(nativeT("desktop.ssh.error.bootstrapTimeout", { host: alias, timeout: timeoutMs })))
    }, timeoutMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", () => {
      clearTimeout(timer)
      resolve(parseBootstrapMarker(stdout + collect.join("")))
    })
  })
}

export async function stopSshServer(
  alias: string,
  opts: { spawn?: typeof spawn; timeoutMs?: number; authEnv?: Record<string, string> } = {},
) {
  if (!opts.authEnv) {
    const askpass = await createAskpassSession(requestAuthPrompt)
    try {
      return await stopSshServer(alias, {
        ...opts,
        authEnv: { ...process.env, ...askpass.env } as Record<string, string>,
      })
    } finally {
      await askpass.dispose()
    }
  }
  const child = (opts.spawn ?? spawn)("ssh", stopArgs(alias), {
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
    env: opts.authEnv,
  })
  child.stdin.end(stopScript())
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill()
      resolve()
    }, opts.timeoutMs ?? 15_000)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    child.once("error", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function forwardLines(
  stream: NodeJS.ReadableStream | null,
  source: "stdout" | "stderr",
  onLine: (line: { stream: "stdout" | "stderr"; text: string }) => void,
) {
  if (!stream) return
  let pending = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk: string) => {
    pending += chunk
    const lines = pending.split(/\r?\n/g)
    pending = lines.pop() ?? ""
    lines.forEach((text) => onLine({ stream: source, text }))
  })
  stream.on("end", () => {
    if (pending) onLine({ stream: source, text: pending })
  })
}
