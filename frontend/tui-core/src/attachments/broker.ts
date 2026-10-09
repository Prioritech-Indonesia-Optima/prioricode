import type { AttachmentPayload, AttachmentReadResult, AttachmentSource, AttachmentTransport } from "./types"

export type BrokerOutcome = Readonly<{
  payload?: AttachmentPayload
  attempts: readonly AttachmentReadResult[]
  status: "attached" | "empty" | "denied" | "unsupported" | "failed"
}>

export function createAttachmentBroker(input: Readonly<{ transports: () => readonly AttachmentTransport[] }>) {
  return {
    async request(preferred?: string): Promise<BrokerOutcome> {
      const attempts: AttachmentReadResult[] = []
      const ordered = order(input.transports(), preferred)
      for (const transport of ordered) {
        if (!transport.available()) {
          attempts.push({ status: "unsupported", source: transport.source, reason: "transport unavailable" })
          continue
        }
        let result: AttachmentReadResult
        try {
          result = await transport.read()
        } catch (error) {
          result = { status: "failed", source: transport.source, error: error instanceof Error ? error.message : String(error) }
        }
        attempts.push(result)
        if (result.status === "attached") return { payload: result.payload, attempts, status: "attached" }
        if (result.status === "denied") return { attempts, status: "denied" }
      }
      if (attempts.some((a) => a.status === "failed")) return { attempts, status: "failed" }
      if (attempts.every((a) => a.status === "unsupported")) return { attempts, status: "unsupported" }
      return { attempts, status: "empty" }
    },
  }
}

function order(transports: readonly AttachmentTransport[], preferred?: string): AttachmentTransport[] {
  const list = [...transports]
  if (!preferred) return list
  const index = list.findIndex((transport) => transport.source.id === preferred)
  if (index <= 0) return list
  const [picked] = list.splice(index, 1)
  return picked ? [picked, ...list] : list
}

export function fakeTransport(source: AttachmentSource, result: AttachmentReadResult | (() => AttachmentReadResult), available = true): AttachmentTransport {
  return {
    source,
    available: () => available,
    read: async () => (typeof result === "function" ? result() : { ...result, source }),
  }
}
