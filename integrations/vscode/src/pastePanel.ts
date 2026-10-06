// Remote windows cannot reach the user's clipboard from the extension host
// (it runs on the remote machine), but webviews render in the local window,
// so a native paste event inside the panel carries the real clipboard image.
import * as vscode from "vscode"
import type { ClipboardImage } from "./clipboard"

const PASTE_TIMEOUT_MS = 60_000

const html = (nonce: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 18px; -webkit-user-select: none; }
  #state { margin-top: 10px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body tabindex="0">
  <h3>Paste your clipboard image</h3>
  <p>Press <b>Ctrl+V</b> (Cmd+V on macOS) here to send the image to the prioricode terminal. Esc closes.</p>
  <div id="state">waiting for paste…</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi()
    const state = document.getElementById('state')
    document.body.focus()
    function encode(bytes) {
      let binary = ''
      const chunk = 0x8000
      const view = new Uint8Array(bytes)
      for (let i = 0; i < view.length; i += chunk) {
        binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk))
      }
      return btoa(binary)
    }
    async function send(item) {
      const file = item.getAsFile ? item.getAsFile() : null
      if (!file) return
      state.textContent = 'sending…'
      const buffer = await file.arrayBuffer()
      vscode.postMessage({ mime: item.type || 'image/png', data: encode(buffer) })
    }
    window.addEventListener('paste', (event) => {
      const items = Array.from((event.clipboardData && event.clipboardData.items) || [])
      const image = items.find((i) => i.type && i.type.indexOf('image/') === 0)
      if (image) {
        event.preventDefault()
        void send(image)
        return
      }
      state.textContent = 'no image found in that paste — copy a screenshot and try again'
    })
  </script>
</body>
</html>`

export function pickClipboardImageViaPanel(): Promise<ClipboardImage | undefined> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      "prioricode.paste",
      "prioricode: Paste Image",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
      },
    )
    panel.webview.html = html(Math.random().toString(36).slice(2))
    let settled = false
    const finish = (image: ClipboardImage | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(image)
      panel.dispose()
    }
    const timer = setTimeout(() => finish(undefined), PASTE_TIMEOUT_MS)
    const message = panel.webview.onDidReceiveMessage((data: unknown) => {
      const record = data as Partial<ClipboardImage>
      if (typeof record?.data !== "string" || typeof record.mime !== "string") return
      finish({ mime: record.mime, data: record.data })
    })
    panel.onDidDispose(() => {
      message.dispose()
      finish(undefined)
    })
  })
}
