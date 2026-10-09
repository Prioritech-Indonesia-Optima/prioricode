export type AttachmentTransportKind = "clipboard" | "drop" | "companion" | "file"

export type AttachmentSource = Readonly<{
  id: string
  label: string
  kind: AttachmentTransportKind
}>

export type AttachmentPayload = Readonly<{
  filename: string
  mime: string
  bytes: Uint8Array
}>

export type AttachmentReadResult =
  | Readonly<{ status: "attached"; source: AttachmentSource; payload: AttachmentPayload }>
  | Readonly<{ status: "empty"; source: AttachmentSource }>
  | Readonly<{ status: "denied"; source: AttachmentSource }>
  | Readonly<{ status: "unsupported"; source: AttachmentSource; reason: string }>
  | Readonly<{ status: "failed"; source: AttachmentSource; error: string }>

export interface AttachmentTransport {
  readonly source: AttachmentSource
  available(): boolean
  read(signal?: AbortSignal): Promise<AttachmentReadResult>
}
