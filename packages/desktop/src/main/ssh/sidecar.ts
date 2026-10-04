import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { checkHealth } from "../server"
import { pollWslHealth } from "../wsl/startup"
import { nativeT } from "../native-translations"
import { classifySshFailure } from "./errors"
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
  spawn?: typeof spawn
}

export async function spawnSshSidecar(alias: string, opts: SshSidecarOptions = {}): Promise<SshSidecar> {
  const username = "prioricode"
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
  if ("code" in boot) throw new Error(bootstrapError(alias, boot.code))
  return boot
}

export function bootstrapError(alias: string, code: string) {
  if (code === "missing_binary") return nativeT("desktop.ssh.error.prioricodeNotInstalled", { host: alias })
  if (code === "busy") return nativeT("desktop.ssh.error.busy", { host: alias })
  if (code.startsWith("insecure_bind"))
    return nativeT("desktop.ssh.error.insecureBind", { host: alias, address: code.slice("insecure_bind".length).trim() })
  return nativeT("desktop.ssh.error.bootstrapFailed", { host: alias, code })
}

function runPreflight(alias: string, opts: SshSidecarOptions) {
  return new Promise<void>((resolve, reject) => {
    const child = (opts.spawn ?? spawn)("ssh", probeArgs(alias), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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
    const child = (opts.spawn ?? spawn)("ssh", args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true })
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
  const child = (opts.spawn ?? spawn)("ssh", tunnelArgs(alias, localPort, boot.port), {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
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
        new Error(
          nativeT("desktop.ssh.error.serverExitedBeforeHealthy", {
            host: alias,
            code: code ?? "null",
            signal: signal ?? "null",
            output: recentOutput.length ? `\n${recentOutput.join("\n")}` : "",
          }),
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

export async function stopSshServer(alias: string, opts: { spawn?: typeof spawn; timeoutMs?: number } = {}) {
  const child = (opts.spawn ?? spawn)("ssh", stopArgs(alias), { stdio: ["pipe", "ignore", "ignore"], windowsHide: true })
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
