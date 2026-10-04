// This method is called when your extension is deactivated
let chatProvider: ChatViewProvider | undefined
export function deactivate() {
  chatProvider?.dispose()
}

import * as vscode from "vscode"
import { spawnSync } from "child_process"
import { pickClipboardImageViaPanel } from "./pastePanel"
import { readClipboardImage, type ClipboardImage } from "./clipboard"
import { ChatViewProvider } from "./chat/panel"

const TERMINAL_NAME = "prioricode"

function hasCli() {
  if (process.platform === "win32") {
    return spawnSync("where", ["prioricode"], { windowsHide: true }).status === 0
  }
  return spawnSync("sh", ["-c", "command -v prioricode >/dev/null 2>&1"]).status === 0
}

export function activate(context: vscode.ExtensionContext) {
  // The server's base64 image ceiling is 5 MiB; keep raw bytes well under it.
  const MAX_CLIPBOARD_IMAGE_BYTES = 3_500_000

  chatProvider = new ChatViewProvider(context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("prioricode.chat", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("prioricode.openChat", async () => {
      await vscode.commands.executeCommand("prioricode.chat.focus")
    }),
    vscode.commands.registerCommand("prioricode.connectServer", async () => {
      const url = await vscode.window.showInputBox({
        title: "Connect to a prioricode server",
        prompt: "Server URL, for example http://192.168.1.20:4096 (leave empty to go back to the local daemon)",
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value.trim()) return undefined
          try {
            const parsed = new URL(value.trim())
            return parsed.protocol === "http:" || parsed.protocol === "https:" ? undefined : "Use an http(s) URL"
          } catch {
            return "Invalid URL"
          }
        },
      })
      if (url === undefined) return
      const trimmed = url.trim()
      if (!trimmed) {
        await context.globalState.update("prioricode.serverUrl", undefined)
        await context.secrets.delete("prioricode.serverPassword")
        await vscode.window.showInformationMessage("prioricode: back to the local daemon.")
      } else {
        let password: string | undefined
        try {
          const parsed = new URL(trimmed)
          if (!parsed.password) {
            password = await vscode.window.showInputBox({
              title: "prioricode server password",
              prompt: "Leave empty if the server is unauthenticated",
              password: true,
              ignoreFocusOut: true,
            })
          }
        } catch {
          return
        }
        await context.globalState.update("prioricode.serverUrl", trimmed)
        if (password) await context.secrets.store("prioricode.serverPassword", password)
        else await context.secrets.delete("prioricode.serverPassword")
      }
      await chatProvider?.refresh()
    }),
    vscode.commands.registerCommand("prioricode.disconnectServer", async () => {
      await context.globalState.update("prioricode.serverUrl", undefined)
      await context.secrets.delete("prioricode.serverPassword")
      await chatProvider?.refresh()
      await vscode.window.showInformationMessage("prioricode: disconnected from remote server.")
    }),
  )

  function portOf(terminal: vscode.Terminal | undefined) {
    if (!terminal) return undefined
    // @ts-ignore
    const port = Number(terminal.creationOptions?.env?.["_EXTENSION_PRIORICODE_PORT"])
    return Number.isInteger(port) && port > 0 ? port : undefined
  }

  const setPasteContext = (terminal: vscode.Terminal | undefined) =>
    void vscode.commands.executeCommand("setContext", "prioricodeTerminalFocused", portOf(terminal) !== undefined)
  setPasteContext(vscode.window.activeTerminal)

  const openNewTerminalDisposable = vscode.commands.registerCommand("prioricode.openNewTerminal", async () => {
    await openTerminal()
  })

  const openTerminalDisposable = vscode.commands.registerCommand("prioricode.openTerminal", async () => {
    // An prioricode terminal already exists => focus it
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal()
  })

  let addFilepathDisposable = vscode.commands.registerCommand("prioricode.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    const terminal = vscode.window.activeTerminal
    if (!terminal) {
      return
    }

    if (terminal.name === TERMINAL_NAME) {
      // @ts-ignore
      const port = terminal.creationOptions.env?.["_EXTENSION_PRIORICODE_PORT"]
      port ? await appendPrompt(parseInt(port), fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  async function attachToTerminal(port: number, image: ClipboardImage) {
    if (Buffer.from(image.data, "base64").byteLength > MAX_CLIPBOARD_IMAGE_BYTES) {
      await vscode.window.showWarningMessage(
        "Clipboard image is too large for PrioriCode (max ~3.5 MB). Paste a file path instead.",
      )
      return
    }
    const body = JSON.stringify({ filename: "clipboard", mime: image.mime, data: image.data })
    try {
      const response = await fetch(`http://localhost:${port}/tui/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      if (response.status === 404) {
        await vscode.window.showWarningMessage("Update prioricode to enable clipboard image paste in terminals.")
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
    } catch (error) {
      await vscode.window.showWarningMessage(
        `Could not reach the prioricode terminal server (${String(error)}). Is prioricode running in this terminal?`,
      )
    }
  }

  const pasteIntoTerminalDisposable = vscode.commands.registerCommand("prioricode.pasteIntoTerminal", async () => {
    const terminal = vscode.window.activeTerminal
    const port = portOf(terminal)
    if (!port) {
      await vscode.commands.executeCommand("workbench.action.terminal.paste")
      return
    }
    // Local windows can read the real clipboard directly (the extension host
    // runs on the user's machine). Remote windows cannot — their host is the
    // remote box — so a small local webview panel captures the native paste
    // event and hands the bytes back. The stable API has no clipboard image.
    const image = vscode.env.remoteName ? await pickClipboardImageViaPanel() : await readClipboardImage()
    if (!image) {
      await vscode.commands.executeCommand("workbench.action.terminal.paste")
      return
    }
    await attachToTerminal(port, image)
  })

  context.subscriptions.push(
    openNewTerminalDisposable,
    openTerminalDisposable,
    addFilepathDisposable,
    pasteIntoTerminalDisposable,
    vscode.window.onDidChangeActiveTerminal((terminal) => setPasteContext(terminal)),
  )

  async function openTerminal() {
    if (!hasCli()) {
      const message = "The prioricode CLI was not found on your PATH."
      const choice = await vscode.window.showInformationMessage(message, "Install prioricode")
      if (choice === "Install prioricode") {
        const terminal = vscode.window.createTerminal({ name: "Install prioricode" })
        terminal.show()
        terminal.sendText(
          process.platform === "win32"
            ? "irm https://github.com/Prioritech-Indonesia-Optima/prioricode/raw/main/install.ps1 | iex"
            : "curl -fsSL https://github.com/Prioritech-Indonesia-Optima/prioricode/raw/main/install | bash",
        )
      }
      return
    }

    // Create a new terminal in split screen
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
      location: {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
      env: {
        _EXTENSION_PRIORICODE_PORT: port.toString(),
        PRIORICODE_CALLER: "vscode",
      },
    })

    terminal.show()
    terminal.sendText(`prioricode --port ${port}`)

    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    // Wait for the terminal to be ready
    let tries = 10
    let connected = false
    do {
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        await fetch(`http://localhost:${port}/app`)
        connected = true
        break
      } catch {}

      tries--
    } while (tries > 0)

    // If connected, append the prompt to the terminal
    if (connected) {
      await appendPrompt(port, `In ${fileRef}`)
      terminal.show()
    }
  }

  async function appendPrompt(port: number, text: string) {
    await fetch(`http://localhost:${port}/tui/append-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    })
  }

  function getActiveFile() {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) {
      return
    }

    const document = activeEditor.document
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder) {
      return
    }

    // Get the relative path from workspace root
    const relativePath = vscode.workspace.asRelativePath(document.uri)
    let filepathWithAt = `@${relativePath}`

    // Check if there's a selection and add line numbers
    const selection = activeEditor.selection
    if (!selection.isEmpty) {
      // Convert to 1-based line numbers
      const startLine = selection.start.line + 1
      const endLine = selection.end.line + 1

      if (startLine === endLine) {
        // Single line selection
        filepathWithAt += `#L${startLine}`
      } else {
        // Multi-line selection
        filepathWithAt += `#L${startLine}-${endLine}`
      }
    }

    return filepathWithAt
  }
}
