// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"
import { spawnSync } from "child_process"

const TERMINAL_NAME = "prioricode"

function hasCli() {
  if (process.platform === "win32") {
    return spawnSync("where", ["prioricode"], { windowsHide: true }).status === 0
  }
  return spawnSync("sh", ["-c", "command -v prioricode >/dev/null 2>&1"]).status === 0
}

export function activate(context: vscode.ExtensionContext) {
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

  context.subscriptions.push(openNewTerminalDisposable, openTerminalDisposable, addFilepathDisposable)

  async function openTerminal() {
    if (!hasCli()) {
      const message = "The prioricode CLI was not found on your PATH."
      const choice = await vscode.window.showInformationMessage(message, "Install prioricode")
      if (choice === "Install prioricode") {
        const terminal = vscode.window.createTerminal({ name: "Install prioricode" })
        terminal.show()
        terminal.sendText(
          process.platform === "win32"
            ? "irm https://code.prioritech.co.id/install.ps1 | iex"
            : "curl -fsSL https://code.prioritech.co.id/install | bash",
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
