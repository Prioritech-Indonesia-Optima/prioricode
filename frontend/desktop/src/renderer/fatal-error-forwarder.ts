type FatalErrorInfo = {
  version?: string
  platform: string
  os?: string
  url: () => string
}

type FatalErrorForwarderOptions = {
  record: (payload: { error: string; url: string; version?: string; platform: string; os?: string }) => Promise<void>
  info: FatalErrorInfo
  max?: number
}

export function createFatalErrorForwarder(options: FatalErrorForwarderOptions) {
  const max = options.max ?? 20
  const seen = new Set<string>()

  return (kind: string, detail: string) => {
    if (!detail) return
    const signature = `${kind}:${detail.slice(0, 180)}`
    if (seen.has(signature) || seen.size >= max) return
    seen.add(signature)
    void options
      .record({
        error: `${kind}: ${detail}`,
        url: options.info.url(),
        version: options.info.version,
        platform: options.info.platform,
        os: options.info.os,
      })
      .catch(() => undefined)
  }
}

export function attachFatalErrorForwarder(options: FatalErrorForwarderOptions) {
  const forward = createFatalErrorForwarder(options)
  const onError = (event: Event) => {
    if (!(event instanceof ErrorEvent)) return
    const detail = event.error instanceof Error ? `${event.error.message}\n${event.error.stack ?? ""}` : event.message
    forward("window-error", detail)
  }
  const onRejection = (event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason
    const detail = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason)
    forward("unhandled-rejection", detail)
  }
  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
  return () => {
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
  }
}
