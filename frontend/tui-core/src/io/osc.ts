import type { InputEvent } from "../types"

export type OscRequest = Readonly<{ code: number; payload: string; terminator?: "bel" | "st" }>

export function encodeOsc(code: number, payload: string, terminator: "bel" | "st" = "bel"): string {
  return `\x1b]${code};${payload}${terminator === "st" ? "\x1b\\" : "\x07"}`
}

export function encodeDcsPassthrough(sequence: string): string {
  return `\x1bPtmux;${sequence.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`
}

export type OscChannel = Readonly<{
  on(code: number, handler: (data: string) => void): () => void
  onDcs(handler: (prefix: string, data: string) => void): () => void
  feed(event: Extract<InputEvent, { kind: "osc" } | { kind: "dcs" }>): void
}>

export function createOscChannel(): OscChannel {
  const oscHandlers = new Map<number, Set<(data: string) => void>>()
  const dcsHandlers = new Set<(prefix: string, data: string) => void>()

  return {
    on(code, handler) {
      let handlers = oscHandlers.get(code)
      if (handlers === undefined) {
        handlers = new Set()
        oscHandlers.set(code, handlers)
      }
      handlers.add(handler)
      const target = handlers
      return () => {
        target.delete(handler)
      }
    },
    onDcs(handler) {
      dcsHandlers.add(handler)
      return () => {
        dcsHandlers.delete(handler)
      }
    },
    feed(event) {
      if (event.kind === "osc") {
        const handlers = oscHandlers.get(event.code)
        if (handlers !== undefined) for (const handler of [...handlers]) handler(event.data)
      } else {
        for (const handler of [...dcsHandlers]) handler(event.prefix, event.data)
      }
    },
  }
}
