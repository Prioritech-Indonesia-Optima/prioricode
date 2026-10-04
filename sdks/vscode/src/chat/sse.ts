export interface SseEvent {
  event?: string
  data: string
}

/**
 * Parses an SSE byte stream into dispatched events. Comment frames (": heartbeat")
 * and unknown fields are ignored; incomplete trailing frames stay buffered.
 * Resolves when the stream ends; rejects on read errors (including abort).
 */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent: string | undefined
  let dataLines: string[] = []

  const dispatch = () => {
    if (dataLines.length > 0) {
      onEvent({ event: currentEvent, data: dataLines.join("\n") })
    }
    currentEvent = undefined
    dataLines = []
  }

  const feedLine = (line: string) => {
    if (line === "") {
      dispatch()
      return
    }
    if (line.startsWith(":")) return
    const colon = line.indexOf(":")
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    if (field === "data") dataLines.push(value)
    else if (field === "event") currentEvent = value
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf("\n")
      while (index >= 0) {
        let line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (line.endsWith("\r")) line = line.slice(0, -1)
        feedLine(line)
        index = buffer.indexOf("\n")
      }
    }
    if (buffer.length > 0) {
      let line = buffer
      if (line.endsWith("\r")) line = line.slice(0, -1)
      feedLine(line)
    }
    dispatch()
  } finally {
    reader.cancel().catch(() => {})
  }
}

export function parseJsonEvent(data: string): unknown | undefined {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

export function backoffDelay(
  attempt: number,
  options?: { base?: number; cap?: number; random?: () => number },
): number {
  const base = options?.base ?? 500
  const cap = options?.cap ?? 15_000
  const random = options?.random ?? Math.random
  const exponential = Math.min(cap, base * Math.pow(2, Math.max(0, attempt)))
  return Math.round(exponential * (0.5 + random() * 0.5))
}
