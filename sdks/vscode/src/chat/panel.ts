import * as vscode from "vscode"
import * as os from "os"
import * as fsp from "fs/promises"
import { execFile } from "child_process"
import { defaultProbe, discover, parseServerTarget, type RemoteTarget, type ServerInfo } from "./server"
import { createBridgeHost, type BridgeHost, type BridgeServerResult } from "./bridge"

const SERVER_URL_SECRET = "prioricode.serverPassword"
const SERVER_URL_STATE = "prioricode.serverUrl"

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "yi", "ps", "sd", "ku"])

/**
 * Host shell for the PrioriCode GUI. The webview is the React bundle built from
 * packages/gui; this class owns only the webview lifecycle, server discovery,
 * and the transport bridge relay. No chat state or protocol logic lives here —
 * everything data-plane crosses packages/gui/src/core via the bridge.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined
  private host: BridgeHost | undefined
  private server: ServerInfo | undefined
  private connecting: Promise<BridgeServerResult> | undefined
  private readonly disposables: vscode.Disposable[] = []

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    }
    view.webview.html = this.renderHtml(view.webview)
    this.host = createBridgeHost({
      post: (message) => {
        void view.webview.postMessage(message)
      },
      resolveServer: () => this.resolveServer(),
      directory: () => this.workspaceDirectory(),
      serverLabel: (url) => this.hostLabel(url),
      log: (message) => console.log("[prioricode chat]", message),
    })
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: unknown) => {
        this.host?.onMessage(message)
      }),
      view.onDidChangeVisibility(() => {
        if (view.visible) this.host?.onMessage({ kind: "retry" })
      }),
    )
  }

  async refresh(): Promise<void> {
    this.server = undefined
    this.connecting = undefined
    this.host?.onMessage({ kind: "retry" })
  }

  dispose(): void {
    this.host?.dispose()
    for (const disposable of this.disposables) disposable.dispose()
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"))
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"))
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
<html lang="${locale}" dir="${dir}" class="vscode-webview">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${cssUri}" />
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
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

  private async resolveServer(): Promise<BridgeServerResult> {
    if (this.server !== undefined) return { ok: true, server: this.server }
    if (this.connecting !== undefined) return this.connecting
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
          return {
            ok: false,
            reason: result.reason,
            detail: result.detail ?? (remote ? `Configured server ${remote.url} is not reachable.` : undefined),
          } as BridgeServerResult
        }
        this.server = result.server
        return { ok: true, server: result.server } as BridgeServerResult
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
}
