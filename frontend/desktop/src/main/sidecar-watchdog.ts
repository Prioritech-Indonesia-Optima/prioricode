type SidecarWatchdogOptions = {
  probe: () => Promise<boolean>
  restart: () => Promise<void>
  isQuitting: () => boolean
  log: (message: string, meta?: Record<string, unknown>) => void
  now?: () => number
  intervalMs?: number
  maxConsecutiveFailures?: number
  restartBaseMs?: number
  restartMaxMs?: number
  healthyResetMs?: number
}

export function startSidecarWatchdog(options: SidecarWatchdogOptions) {
  const intervalMs = options.intervalMs ?? 15_000
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 2
  const restartBaseMs = options.restartBaseMs ?? 15_000
  const restartMaxMs = options.restartMaxMs ?? 300_000
  const healthyResetMs = options.healthyResetMs ?? 60_000
  const now = options.now ?? Date.now
  let failures = 0
  let inFlight = false
  let stopped = false
  let restartDelayMs = 0
  let lastRestartAt = Number.NEGATIVE_INFINITY

  const tick = async () => {
    if (stopped || inFlight || options.isQuitting()) return
    inFlight = true
    try {
      const healthy = await options.probe().catch(() => false)
      if (healthy) {
        failures = 0
        if (lastRestartAt && now() - lastRestartAt > healthyResetMs) {
          restartDelayMs = 0
          lastRestartAt = 0
        }
        return
      }
      failures += 1
      options.log("sidecar health probe failed", { failures })
      if (failures < maxConsecutiveFailures) return
      const current = now()
      if (current - lastRestartAt < restartDelayMs) return
      failures = 0
      lastRestartAt = current
      restartDelayMs = restartDelayMs === 0 ? restartBaseMs : Math.min(restartDelayMs * 2, restartMaxMs)
      options.log("sidecar unhealthy, restarting", { nextRestartSpacingMs: restartDelayMs })
      await options.restart()
      options.log("sidecar restarted")
    } catch (error) {
      options.log("sidecar restart failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      inFlight = false
    }
  }

  const timer = setInterval(() => {
    void tick()
  }, intervalMs)
  timer.unref()

  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
    poke: () => {
      void tick()
    },
  }
}
