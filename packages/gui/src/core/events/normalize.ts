export interface RawEventDurable {
  aggregateID: string
  seq: number
  version: number
}

export interface RawEvent {
  id?: string
  type: string
  durable?: RawEventDurable
  location?: unknown
  metadata?: unknown
  data?: unknown
}

/**
 * The V2 live `/api/event` handler lowers frames as `{ id, type, properties }`
 * while durable and declared envelopes use `data`. The fold consumes a single
 * normalized shape; without this funnel live-only payloads silently drop.
 */
export function normalizeEvent(value: unknown): RawEvent | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.type !== "string") return undefined
  const data = record.data !== undefined ? record.data : record.properties
  const durable =
    typeof record.durable === "object" && record.durable !== null ? (record.durable as RawEventDurable) : undefined
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    type: record.type,
    ...(durable === undefined ? {} : { durable }),
    ...(record.location === undefined ? {} : { location: record.location }),
    ...(record.metadata === undefined ? {} : { metadata: record.metadata }),
    data,
  }
}
