type ReloadGuardOptions = {
  isAlive: () => boolean
  reload: () => void
  now?: () => number
  cooldownMs?: number
}

export function createReloadGuard(options: ReloadGuardOptions) {
  const now = options.now ?? Date.now
  const cooldownMs = options.cooldownMs ?? 10_000
  let lastReload = Number.NEGATIVE_INFINITY

  return {
    tryReload() {
      if (!options.isAlive()) return false
      if (now() - lastReload < cooldownMs) return false
      lastReload = now()
      options.reload()
      return true
    },
  }
}
