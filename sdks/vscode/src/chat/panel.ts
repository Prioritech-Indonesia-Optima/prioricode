import * as vscode from "vscode"
import * as os from "os"
import * as fsp from "fs/promises"
import { execFile } from "child_process"
import { defaultProbe, discover, type ServerInfo } from "./server"
import { ApiError, attachmentFile, createClient, type ChatClient } from "./client"
import { createConnection, type Connection } from "./connection"
import { applyEvent, optimisticUser } from "./reducer"
import { emptyState, type ChatState, type OutgoingAttachment, type RawEvent, type WebviewToHost } from "./types"

const MAX_ATTACHMENT_BASE64 = Math.ceil(3_500_000 / 3) * 4
const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

const newMessageID = () => `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

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

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "images")],
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

  dispose(): void {
    this.connection?.stop()
    if (this.postTimer !== undefined) clearTimeout(this.postTimer)
    for (const disposable of this.disposables) disposable.dispose()
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"))
    const csp = [
      `default-src 'none'`,
      `img-src data: ${webview.cspSource}`,
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
    ].join("; ")
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; flex-direction: column;
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  #header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  #header .title { font-weight: 600; }
  #header .spacer { flex: 1; }
  #banner { padding: 8px; background: var(--vscode-input-warningBackground, var(--vscode-editorWarning-foreground)); display: none; }
  #banner.visible { display: block; color: var(--vscode-editor-background); }
  #banner.error { background: var(--vscode-editorWarning-foreground); }
  #transcript { flex: 1; overflow-y: auto; padding: 10px 8px; display: flex; flex-direction: column; gap: 10px; }
  .block { border-radius: 6px; padding: 8px 10px; }
  .block.user { background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); align-self: flex-end; max-width: 95%; }
  .block.assistant { max-width: 100%; }
  .block.system { color: var(--vscode-descriptionForeground); font-size: 0.9em; font-style: italic; }
  .block.system.error { color: var(--vscode-errorForeground); font-style: normal; }
  .block .who { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 3px; }
  .block .text { white-space: pre-wrap; word-break: break-word; }
  .block .meta { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-top: 4px; }
  .block img.pasted { max-width: 100%; max-height: 180px; border-radius: 4px; display: block; margin-top: 6px; }
  details.part { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 3px 8px; margin: 4px 0; background: var(--vscode-editor-background); }
  details.part summary { cursor: pointer; }
  details.part pre { white-space: pre-wrap; word-break: break-word; margin: 4px 0; font-family: var(--vscode-editor-font-family); font-size: 0.9em; max-height: 240px; overflow-y: auto; }
  .status-running::after { content: " ⋯"; }
  .status-error { color: var(--vscode-errorForeground); }
  .status-success { color: var(--vscode-descriptionForeground); }
  .card { border: 1px solid var(--vscode-editorInfo-foreground, var(--vscode-panel-border)); border-radius: 6px; padding: 8px 10px; background: var(--vscode-editorWidget-background); }
  .card .buttons { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  button {
    font: inherit; cursor: pointer; padding: 3px 10px; border-radius: 4px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  #composer { border-top: 1px solid var(--vscode-panel-border); padding: 8px; }
  #attachments { display: flex; gap: 6px; flex-wrap: wrap; }
  #attachments:empty { display: none; }
  #attachments .chip { position: relative; border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 2px; }
  #attachments .chip img { max-height: 60px; max-width: 100px; border-radius: 3px; display: block; }
  #attachments .chip button { position: absolute; top: -6px; right: -6px; padding: 0 4px; border-radius: 50%; line-height: 14px; }
  #inputrow { display: flex; gap: 6px; align-items: flex-end; margin-top: 6px; }
  textarea {
    flex: 1; resize: none; font: inherit; padding: 6px 8px; border-radius: 4px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
  #empty { margin: auto; text-align: center; color: var(--vscode-descriptionForeground); }
  #empty h2 { font-weight: 500; }
</style>
</head>
<body>
  <div id="app">
    <div id="header">
      <span class="title">prioricode</span>
      <span class="spacer"></span>
      <button id="new-session" class="secondary" title="Start a new session">New session</button>
    </div>
    <div id="banner"><span id="banner-text"></span> <button id="banner-retry" class="secondary">Retry</button></div>
    <div id="transcript"><div id="empty"><h2>Welcome to prioricode</h2><div>What would you like to do?</div></div></div>
    <div id="composer">
      <div id="attachments"></div>
      <div id="inputrow">
        <textarea id="input" rows="2" placeholder="Ask prioricode or paste an image with Ctrl+V"></textarea>
        <button id="stop" class="secondary" title="Interrupt" disabled>Stop</button>
        <button id="send" title="Send">Send</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
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
    this.connecting = discover({
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
    }).then((result) => {
      this.connecting = undefined
      if (!result.ok) {
        this.setStatus(result.reason, result.detail)
        return
      }
      this.server = result.server
      this.client = createClient({ url: result.server.url, username: result.server.username, password: result.server.password })
      this.setStatus("ready")
    })
    return this.connecting
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
      // The request may have been resolved by another client; that is fine.
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) return
      this.noteError(error)
    }
  }

  private resetSession(): void {
    this.connection?.stop()
    this.connection = undefined
    this.sessionID = undefined
    this.state = { ...emptyState(), status: this.state.status === "ready" ? "ready" : this.state.status }
    this.post(true)
  }

  private async send(messageID: string, text: string, attachments: OutgoingAttachment[]): Promise<void> {
    if (!this.client) await this.connect()
    const client = this.client
    if (!client) {
      this.noteError(new Error(`No prioricode server available (${this.state.status}). Use Retry after starting the service.`))
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
        // Session vanished server-side; drop it so the next send recreates one.
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
            this.state = applyEvent(this.state, { id: `resync:${request.id}`, type: "permission.v2.asked", data: request })
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
