import { createConnection, type Connection } from "../core/connection"
import { normalizeEvent, type RawEvent } from "../core/events/normalize"
import {
  emptyTranscript,
  foldTranscript,
  optimisticUser,
  type OutgoingAttachment,
  type PermissionReply,
  type TranscriptState,
} from "../core/fold/transcript"
import { clientErrorMessage, isSessionNotFoundError, isSettledReplyFailure, statusOf } from "../core/transport/errors"
import type { AppTransport } from "./transport"

export type StoreStatus = "connecting" | "ready" | "offline" | "auth-mismatch" | "no-cli" | "error"

export interface StoreState {
  status: StoreStatus
  statusDetail?: string
  serverLabel?: string
  directory?: string
  sessionID?: string
  restoring: boolean
  transcript: TranscriptState
  note?: string
}

export interface ChatStore {
  getSnapshot: () => StoreState
  subscribe: (listener: () => void) => () => void
  send: (text: string, attachments?: OutgoingAttachment[], opts?: { delivery?: "steer" | "queue" }) => Promise<void>
  interrupt: () => Promise<void>
  replyPermission: (requestID: string, reply: PermissionReply) => Promise<void>
  replyQuestion: (requestID: string, answers: string[][]) => Promise<void>
  rejectQuestion: (requestID: string) => Promise<void>
  selectSession: (sessionID: string | undefined) => void
  newSession: () => void
  setAgent: (agent: string) => Promise<void>
  setModel: (model: { id: string; providerID: string; variant?: string }) => Promise<void>
  retry: () => void
  notify: (message: string) => void
  setConfig: (status: StoreStatus, detail?: string) => void
  dispose: () => void
}

const newMessageID = () => `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
const MAX_ATTACHMENT_BASE64 = Math.ceil(3_500_000 / 3) * 4
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const HISTORY_PAGE = 100
const HISTORY_MAX_PAGES = 200

const attachmentFile = (attachment: OutgoingAttachment) => ({
  uri: `data:${attachment.mime};base64,${attachment.dataBase64}`,
  name: attachment.name,
})

export function createChatStore(transport: AppTransport): ChatStore {
  let state: StoreState = {
    status: transport.status,
    statusDetail: transport.statusDetail,
    serverLabel: transport.serverLabel,
    directory: transport.directory,
    restoring: false,
    transcript: emptyTranscript(),
  }
  const listeners = new Set<() => void>()
  let queued = false
  let connection: Connection | undefined
  let sessionID: string | undefined
  let disposed = false

  const flush = () => {
    queued = false
    if (disposed) return
    for (const listener of listeners) listener()
  }
  const notify = () => {
    if (queued) return
    queued = true
    setTimeout(flush, 16)
  }
  const set = (patch: Partial<StoreState>) => {
    state = { ...state, ...patch }
    notify()
  }

  const applyEvent = (event: RawEvent) => {
    const folded = foldTranscript(state.transcript, event)
    if (folded.state === state.transcript) return
    state = { ...state, transcript: folded.state, sessionID }
    notify()
  }

  const startConnection = (initialLastSeq = 0) => {
    const currentSession = sessionID
    if (currentSession === undefined) return
    connection?.stop()
    connection = createConnection({
      sessionID: currentSession,
      initialLastSeq,
      openStream: transport.openStream,
      onEvent: applyEvent,
      onResync: async () => {
        const client = transport.client
        if (client === undefined) return
        try {
          const [permissions, questions] = await Promise.all([
            client.permissions.list({ sessionID: currentSession }).catch(() => [] as never[]),
            client.questions.list({ sessionID: currentSession }).catch(() => [] as never[]),
          ])
          for (const request of permissions) {
            applyEvent({ id: `resync:${String(request.id)}`, type: "permission.v2.asked", data: request })
          }
          for (const request of questions) {
            applyEvent({ id: `resync:${String(request.id ?? newMessageID())}`, type: "question.v2.asked", data: request })
          }
        } catch {
          // Resync is best-effort; live events still flow.
        }
      },
      onError: (error, scope) => console.log("[gui]", scope, "stream error:", String(error)),
    })
    connection.start()
  }

  const restoreSession = async (target: string) => {
    const client = transport.client
    state = { ...state, sessionID: target, restoring: true, transcript: emptyTranscript() }
    notify()
    if (client === undefined) {
      set({ restoring: false })
      return
    }
    let transcript = emptyTranscript()
    let after: number | undefined
    let maxSeq = 0
    try {
      for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
        const result = await client.sessions.history({ sessionID: target, limit: HISTORY_PAGE, ...(after === undefined ? {} : { after }) })
        const events = result.data ?? []
        for (const event of events) {
          const normalized = normalizeEvent(event)
          if (normalized === undefined) continue
          transcript = foldTranscript(transcript, normalized).state
          const seq = normalized.durable?.seq
          if (typeof seq === "number" && seq > maxSeq) maxSeq = seq
        }
        if (result.hasMore !== true) break
        const lastSeq = events[events.length - 1]?.durable?.seq
        if (typeof lastSeq !== "number") break
        after = lastSeq
      }
    } catch (error) {
      set({ note: clientErrorMessage(error) })
    }
    if (disposed || sessionID !== target) return
    state = { ...state, restoring: false, transcript }
    notify()
    startConnection(maxSeq)
  }

  const selectSession = (target: string | undefined) => {
    if (target === sessionID) return
    connection?.stop()
    connection = undefined
    sessionID = target
    if (target === undefined) {
      state = { ...state, sessionID: undefined, restoring: false, transcript: emptyTranscript() }
      notify()
      return
    }
    void restoreSession(target)
  }

  const ensureSession = async (): Promise<boolean> => {
    if (sessionID !== undefined) return true
    const client = transport.client
    if (client === undefined) {
      set({ note: "Server is not connected. Use Retry after starting the service." })
      return false
    }
    const directory = transport.directory ?? state.directory
    if (directory === undefined) {
      set({ note: "Open a folder before chatting so prioricode knows the project directory." })
      return false
    }
    try {
      const created = await client.sessions.create({
        location: { directory },
        ...(transport.defaultModel === undefined ? {} : { model: transport.defaultModel }),
      })
      sessionID = created.id
      set({ sessionID, note: undefined })
      startConnection()
      return true
    } catch (error) {
      if (statusOf(error) === 401) {
        set({ status: "auth-mismatch", statusDetail: "The server rejected the stored password." })
      } else {
        set({ note: clientErrorMessage(error) })
      }
      return false
    }
  }

  const send = async (text: string, attachments: OutgoingAttachment[] = [], opts?: { delivery?: "steer" | "queue" }) => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    if (!(await ensureSession())) return
    const files: { uri: string; name?: string }[] = []
    const accepted: OutgoingAttachment[] = []
    for (const attachment of attachments) {
      if (!IMAGE_MIMES.has(attachment.mime)) {
        set({ note: `Skipped unsupported attachment type ${attachment.mime}` })
        continue
      }
      if (attachment.dataBase64.length > MAX_ATTACHMENT_BASE64) {
        set({ note: `Skipped oversized image (${attachment.name ?? "clipboard"}); max ~3.5 MB` })
        continue
      }
      files.push(attachmentFile(attachment))
      accepted.push(attachment)
    }
    const messageID = newMessageID()
    state = { ...state, transcript: optimisticUser(state.transcript, messageID, trimmed, accepted) }
    notify()
    try {
      await transport.client!.sessions.prompt({
        sessionID: sessionID as string,
        id: messageID,
        prompt: {
          text: trimmed,
          ...(files.length === 0 ? {} : { files }),
        },
        ...(opts?.delivery === undefined ? {} : { delivery: opts.delivery }),
      })
    } catch (error) {
      if (isSessionNotFoundError(error)) {
        selectSession(undefined)
        set({ note: "Session no longer exists; a new one will be created on the next message." })
        return
      }
      set({ note: clientErrorMessage(error) })
    }
  }

  const interrupt = async () => {
    if (sessionID === undefined || transport.client === undefined) return
    try {
      await transport.client.sessions.interrupt({ sessionID })
    } catch (error) {
      set({ note: clientErrorMessage(error) })
    }
  }

  const replyPermission = async (requestID: string, reply: PermissionReply) => {
    if (sessionID === undefined || transport.client === undefined) return
    try {
      await transport.client.permissions.reply({ sessionID, requestID, reply })
    } catch (error) {
      if (isSettledReplyFailure(error)) return
      set({ note: clientErrorMessage(error) })
    }
  }

  const replyQuestion = async (requestID: string, answers: string[][]) => {
    if (sessionID === undefined || transport.client === undefined) return
    try {
      await transport.client.questions.reply({ sessionID, requestID, answers })
    } catch (error) {
      if (isSettledReplyFailure(error)) return
      set({ note: clientErrorMessage(error) })
    }
  }

  const rejectQuestion = async (requestID: string) => {
    if (sessionID === undefined || transport.client === undefined) return
    try {
      await transport.client.questions.reject({ sessionID, requestID })
    } catch (error) {
      if (isSettledReplyFailure(error)) return
      set({ note: clientErrorMessage(error) })
    }
  }

  const setAgent = async (agent: string) => {
    if (sessionID === undefined || transport.client === undefined) return
    try {
      await transport.client.sessions.switchAgent({ sessionID, agent })
    } catch (error) {
      set({ note: clientErrorMessage(error) })
    }
  }

  const setModel = async (model: { id: string; providerID: string; variant?: string }) => {
    if (sessionID === undefined || transport.client === undefined) return
    try {
      await transport.client.sessions.switchModel({ sessionID, model })
    } catch (error) {
      set({ note: clientErrorMessage(error) })
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    send,
    interrupt,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    selectSession,
    newSession: () => selectSession(undefined),
    setAgent,
    setModel,
    retry: () => transport.retry(),
    notify: (message) => set({ note: message }),
    setConfig: (status, detail) => set({ status, statusDetail: detail }),
    dispose: () => {
      disposed = true
      connection?.stop()
      listeners.clear()
    },
  }
}
