type ProcessGuardOptions = {
  log: (message: string, meta: Record<string, unknown>) => void
  relaunch: () => void
  isQuitting: () => boolean
  exit: (code: number) => void
}

export function describeError(value: unknown) {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  return { message: String(value) }
}

export function installProcessGuards(options: ProcessGuardOptions) {
  let crashHandled = false

  const onRejection = (reason: unknown) => {
    options.log("unhandled rejection", { reason: describeError(reason) })
  }

  const onException = (error: unknown) => {
    options.log("uncaught exception", { error: describeError(error) })
    if (crashHandled || options.isQuitting()) return
    crashHandled = true
    try {
      options.relaunch()
    } catch (relaunchError) {
      options.log("relaunch after crash failed", { error: describeError(relaunchError) })
      options.exit(1)
    }
  }

  process.on("unhandledRejection", onRejection)
  process.on("uncaughtException", onException)

  return () => {
    process.off("unhandledRejection", onRejection)
    process.off("uncaughtException", onException)
  }
}
