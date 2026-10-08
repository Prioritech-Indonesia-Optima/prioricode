// Real-PTY test fixture. Spawns a process under a util-linux `script` PTY and
// splits its output byte stream into complete OSC units, so tests can drive
// the actual readTerminalClipboard pipeline over real terminal bytes —
// including a real tmux server with allow-passthrough.
import { spawnPty } from "./spawn-pty"

type Waiter = (unit: string | undefined) => void

export type PtyBridge = Readonly<{
  write(s: string): void
  nextUnit(timeoutMs: number): Promise<string | undefined>
  waitForUnit(predicate: (unit: string) => boolean, timeoutMs: number): Promise<string | undefined>
  startInputRouter(): Readonly<{
    handlers: Set<(raw: string) => boolean>
    stop(): void
  }>
  kill(): void
  closed(): Promise<void>
}>

export function openPty(command: string, env?: Record<string, string>): PtyBridge {
  const child = spawnPty(command, env)
  const units: string[] = []
  const waiters: Waiter[] = []
  let buffer = ""
  let closedResolve: (() => void) | undefined
  const closed = new Promise<void>((resolve) => {
    closedResolve = resolve
  })
  const decoder = new TextDecoder()

  const scan = () => {
    for (;;) {
      const start = buffer.indexOf("\x1b]")
      if (start === -1) {
        buffer = buffer.endsWith("\x1b") ? "\x1b" : ""
        return
      }
      const end = buffer.indexOf("\x07", start)
      const st = buffer.indexOf("\x1b\\", start)
      let stop = -1
      if (end !== -1 && (st === -1 || end < st)) stop = end + 1
      else if (st !== -1) stop = st + 2
      if (stop === -1) {
        buffer = buffer.slice(start)
        return
      }
      const unit = buffer.slice(start, stop)
      buffer = buffer.slice(stop)
      const waiter = waiters.shift()
      if (waiter) waiter(unit)
      else units.push(unit)
    }
  }

  void (async () => {
    const reader = child.stdout.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      scan()
    }
    for (const waiter of waiters.splice(0)) waiter(undefined)
    closedResolve?.()
  })()

  const nextUnit = (timeoutMs: number): Promise<string | undefined> => {
    const queued = units.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const once: Waiter = (unit) => {
        if (timer !== undefined) clearTimeout(timer)
        resolve(unit)
      }
      waiters.push(once)
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const index = waiters.indexOf(once)
          if (index !== -1) waiters.splice(index, 1)
          resolve(undefined)
        }, timeoutMs)
      }
    })
  }

  const bridge: PtyBridge = {
    write: (s) => void child.stdin.write(s),
    nextUnit,
    async waitForUnit(predicate, timeoutMs) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) return undefined
        const unit = await nextUnit(remaining)
        if (unit === undefined) return undefined
        if (predicate(unit)) return unit
      }
    },
    startInputRouter() {
      const handlers = new Set<(raw: string) => boolean>()
      let stopped = false
      void (async () => {
        while (!stopped) {
          const unit = await nextUnit(0)
          if (unit === undefined) break
          for (const handler of handlers) if (handler(unit)) break
        }
      })()
      return {
        handlers,
        stop: () => {
          stopped = true
          handlers.clear()
        },
      }
    },
    kill: () => {
      try {
        child.kill()
      } catch {}
    },
    closed: () => closed,
  }
  return bridge
}

export const tmuxAvailable = () => Bun.which("tmux") !== null && process.platform !== "win32"
export const scriptAvailable = () => process.platform === "linux" && Bun.which("script") !== null

export function tmuxBridge(
  opts: Readonly<{ conf: string; sock: string; name: string; cols: number; rows: number; pane: string }>,
): string {
  return (
    `tmux -2 -f ${opts.conf} -L ${opts.sock} new-session -d -x ${opts.cols} -y ${opts.rows} -s ${opts.name} '${opts.pane}'; ` +
    `sleep 0.4; tmux -2 -L ${opts.sock} attach -t ${opts.name}`
  )
}

export function killTmuxServer(sock: string) {
  Bun.spawnSync(["tmux", "-L", sock, "kill-server"])
}
