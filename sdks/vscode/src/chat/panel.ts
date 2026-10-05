import * as vscode from "vscode"
import * as os from "os"
import * as fsp from "fs/promises"
import { execFile } from "child_process"
import { defaultProbe, discover, parseServerTarget, type RemoteTarget, type ServerInfo } from "./server"
import { ApiError, attachmentFile, createClient, type ChatClient } from "./client"
import { createConnection, type Connection } from "./connection"
import { applyEvent, optimisticUser } from "./reducer"
import { emptyState, type ChatState, type OutgoingAttachment, type RawEvent, type WebviewToHost } from "./types"

const MAX_ATTACHMENT_BASE64 = Math.ceil(3_500_000 / 3) * 4
const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const SERVER_URL_SECRET = "prioricode.serverPassword"
const SERVER_URL_STATE = "prioricode.serverUrl"

const newMessageID = () => `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "yi", "ps", "sd", "ku"])

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined
  private state: ChatState = emptyState()
  private client: ChatClient | undefined
  private server: ServerInfo | undefined
  private connection: Connection | undefined
  private sessionID: string | undefined
  private connecting: Promise<void> | undefined
  private postTimer: ReturnType<typeof setTimeout> | undefined
  private readonly disposables: vscode.Disposable[] = []

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    }
    view.webview.html = this.renderHtml(view.webview)
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: WebviewToHost) => {
        void this.handle(message)
      }),
      view.onDidChangeVisibility(() => {
        if (view.visible) this.post(true)
      }),
    )
    void this.connect()
  }

  async refresh(): Promise<void> {
    this.connection?.stop()
    this.connection = undefined
    this.sessionID = undefined
    this.client = undefined
    this.server = undefined
    this.connecting = undefined
    this.state = { ...emptyState(), blocks: this.state.blocks }
    await this.connect()
  }

  dispose(): void {
    this.connection?.stop()
    if (this.postTimer !== undefined) clearTimeout(this.postTimer)
    for (const disposable of this.disposables) disposable.dispose()
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"))
    const chatUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "ide-chat.js"))
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "ide-chat.css"))
    const csp = [
      "default-src 'none'",
      `img-src data: ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join("; ")
    const locale = vscode.env.language
    const dir = RTL_LANGUAGES.has(locale.slice(0, 2).toLowerCase()) ? "rtl" : "ltr"
    return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${cssUri}" />
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${chatUri}"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  private async remoteTarget(): Promise<RemoteTarget | undefined> {
    const stored = this.context.globalState.get<string>(SERVER_URL_STATE)
    const configured = vscode.workspace.getConfiguration("prioricode").get<string>("serverUrl", "").trim()
    const raw = (stored ?? "").trim() || configured
    if (!raw) return undefined
    const secret = await this.context.secrets.get(SERVER_URL_SECRET)
    return parseServerTarget(raw, secret)
  }

  private workspaceDirectory(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  }

  private setStatus(status: ChatState["status"], detail?: string): void {
    this.state = { ...this.state, status, ...(detail === undefined ? {} : { statusDetail: detail }) }
    this.post()
  }

  private async connect(): Promise<void> {
    if (this.connecting) return this.connecting
    this.setStatus("connecting")
    const trusted = vscode.workspace.isTrusted
    this.connecting = Promise.all([
      this.remoteTarget(),
      discover({
        env: process.env as Record<string, string | undefined>,
        homedir: os.homedir,
        readFile: (file) => fsp.readFile(file, "utf8"),
        probe: (server) => defaultProbe(fetch, server),
        startDaemon: trusted
          ? () =>
              new Promise<boolean>((resolve) => {
                execFile("prioricode", ["service", "start"], { timeout: 20_000 }, (error) => resolve(!error))
              })
          : undefined,
        log: (message) => console.log("[prioricode chat]", message),
      }),
    ])
      .then(([remote, result]) => {
        if (!result.ok) {
          this.setStatus(
            result.reason,
            result.detail ?? (remote ? `Configured server ${remote.url} is not reachable.` : undefined),
          )
          return
        }
        this.server = result.server
        this.client = createClient({
          url: result.server.url,
          username: result.server.username,
          password: result.server.password,
        })
        const label = this.hostLabel(result.server.url)
        this.state = { ...this.state, status: "ready", statusDetail: undefined, serverUrl: label }
        this.post()
      })
      .finally(() => {
        this.connecting = undefined
      })
    return this.connecting
  }

  private hostLabel(url: string): string | undefined {
    try {
      const parsed = new URL(url)
      if (["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) return undefined
      return parsed.host
    } catch {
      return undefined
    }
  }

  private async handle(message: WebviewToHost): Promise<void> {
    switch (message?.type) {
      case "ready":
        this.post(true)
        return
      case "retry":
        this.connecting = undefined
        await this.connect()
        return
      case "send":
        await this.send(message.messageID, message.text, message.attachments ?? [])
        return
      case "interrupt":
        await this.run(() => this.client?.interrupt(this.sessionID ?? ""))
        return
      case "permission-reply":
        await this.replyPermission(message.requestID, message.reply)
        return
      case "question-reply":
        await this.run(() => this.client?.replyQuestion(this.sessionID ?? "", message.requestID, message.answers))
        return
      case "question-reject":
        await this.run(() => this.client?.rejectQuestion(this.sessionID ?? "", message.requestID))
        return
      case "new-session":
        this.resetSession()
        return
    }
  }

  private async run(action: () => Promise<unknown> | undefined): Promise<void> {
    try {
      await action()
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return
      this.noteError(error)
    }
  }

  private noteError(error: unknown): void {
    const detail = error instanceof ApiError ? ` (${error.status})` : ""
    this.state = {
      ...this.state,
      blocks: [
        ...this.state.blocks,
        { kind: "system", id: newMessageID(), text: `${String(error)}${detail}`, tone: "error" },
      ],
    }
    this.post()
  }

  private async replyPermission(requestID: string, reply: "once" | "always" | "reject"): Promise<void> {
    const sessionID = this.sessionID
    if (!sessionID || !this.client) return
    try {
      await this.client.replyPermission(sessionID, requestID, reply)
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) return
      this.noteError(error)
    }
  }

  private resetSession(): void {
    this.connection?.stop()
    this.connection = undefined
    this.sessionID = undefined
    this.state = { ...emptyState(), status: this.state.status, serverUrl: this.state.serverUrl }
    this.post(true)
  }

  private async send(messageID: string, text: string, attachments: OutgoingAttachment[]): Promise<void> {
    if (!this.client) await this.connect()
    const client = this.client
    if (!client) {
      this.noteError(
        new Error(`No prioricode server available (${this.state.status}). Use Retry after starting the service.`),
      )
      return
    }
    const files: ReturnType<typeof attachmentFile>[] = []
    for (const attachment of attachments) {
      if (!ALLOWED_IMAGE_MIMES.has(attachment.mime)) {
        this.noteError(new Error(`Skipped unsupported attachment type ${attachment.mime}`))
        continue
      }
      if (attachment.dataBase64.length > MAX_ATTACHMENT_BASE64) {
        this.noteError(new Error(`Skipped oversized image (${attachment.name ?? "clipboard"}); max ~3.5 MB`))
        continue
      }
      files.push(attachmentFile(attachment))
    }
    if (!this.sessionID) {
      const directory = this.workspaceDirectory()
      if (directory === undefined) {
        this.noteError(new Error("Open a folder before chatting so prioricode knows the project directory."))
        return
      }
      try {
        this.sessionID = await client.createSession(directory)
        this.startConnection(client, this.sessionID)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          this.server = undefined
          this.client = undefined
          this.setStatus("auth-mismatch", "The server rejected the stored password.")
          return
        }
        this.noteError(error)
        return
      }
    }
    const sessionID = this.sessionID
    this.state = optimisticUser(this.state, messageID, text, attachments)
    this.post(true)
    try {
      await client.prompt({ sessionID, messageID, text, files })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        this.resetSession()
        this.noteError(new Error("Session no longer exists; a new one will be created on the next message."))
        return
      }
      this.noteError(error)
    }
  }

  private startConnection(client: ChatClient, sessionID: string): void {
    this.connection?.stop()
    this.connection = createConnection({
      sessionID,
      openStream: (route, signal) => client.openStream(route, signal),
      onEvent: (event: RawEvent) => {
        this.state = applyEvent(this.state, event)
        this.post()
      },
      onResync: async () => {
        try {
          const [permissions, questions] = await Promise.all([
            client.listPermissions(sessionID).catch(() => []),
            client.listQuestions(sessionID).catch(() => []),
          ])
          for (const request of permissions) {
            this.state = applyEvent(this.state, {
              id: `resync:${request.id}`,
              type: "permission.v2.asked",
              data: request,
            })
          }
          for (const request of questions) {
            this.state = applyEvent(this.state, {
              id: `resync:${String(request.id ?? Math.random())}`,
              type: "question.v2.asked",
              data: request,
            })
          }
          this.post()
        } catch {
          // Resync is best-effort; live events still flow.
        }
      },
      onError: (error, scope) => console.log("[prioricode chat]", scope, "stream error:", String(error)),
    })
    this.connection.start()
  }

  private post(immediate = false): void {
    const view = this.view
    if (!view) return
    const send = () => {
      this.postTimer = undefined
      this.view?.webview.postMessage({ type: "state", state: this.state })
    }
    if (this.postTimer !== undefined) clearTimeout(this.postTimer)
    if (immediate) return send()
    this.postTimer = setTimeout(send, 50)
  }
}
