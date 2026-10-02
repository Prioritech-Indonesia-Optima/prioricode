import type { Argv } from "yargs"
import { spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { read, type Content } from "@prioricode/tui/clipboard"
import { PASTE_BRIDGE_DEFAULT_PORT, type BridgePayload } from "@prioricode/tui/paste-bridge"
import { UI } from "../ui"

export function clipboardPayload(content: Content | undefined): BridgePayload | undefined {
  if (content === undefined) return undefined
  if (content.mime === "text/plain") return { text: content.data }
  if (content.mime.startsWith("image/")) return { image: { base64: content.data, mime: content.mime } }
  return undefined
}

export const SSH_BRIDGE_MARKER = "# prioricode clipboard bridge (added by: prioricode paste-serve --setup)"

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function ensureRemoteForward(config: string, port: number): Readonly<{ text: string; changed: boolean }> {
  const managed = new RegExp(
    `${escapeRegExp(SSH_BRIDGE_MARKER)}\\nHost \\*\\n {2}RemoteForward (\\d+) localhost:\\d+\\n?`,
  )
  const match = managed.exec(config)
  const block = (value: number) => `${SSH_BRIDGE_MARKER}\nHost *\n  RemoteForward ${value} localhost:${value}\n`
  if (match) {
    if (match[1] === String(port)) return { text: config, changed: false }
    return { text: config.replace(managed, block(port)), changed: true }
  }
  if (new RegExp(`RemoteForward\\s+${port}\\s`).test(config)) return { text: config, changed: false }
  return { text: config.replace(/\s*$/, "") + `\n` + block(port), changed: true }
}

export function autostartTarget(
  platform: NodeJS.Platform,
  home: string,
  args: ReadonlyArray<string>,
): Readonly<{ kind: "file" | "registry"; path?: string; content?: string; mode?: number; regArgs?: string[] }> {
  const quoted = args.map((arg) => `"${arg}"`).join(" ")
  if (platform === "win32")
    return {
      kind: "registry",
      regArgs: [
        "add",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "/v",
        "PrioriCodePasteBridge",
        "/t",
        "REG_SZ",
        "/d",
        quoted,
        "/f",
      ],
    }
  if (platform === "darwin")
    return {
      kind: "file",
      path: path.join(home, "Library", "LaunchAgents", "com.prioricode.paste-serve.plist"),
      mode: 0o644,
      content: `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>com.prioricode.paste-serve</string>
  <key>ProgramArguments</key><array>${args.map((arg) => `<string>${arg}</string>`).join("")}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
`,
    }
  return {
    kind: "file",
    path: path.join(home, ".config", "autostart", "prioricode-paste-serve.desktop"),
    mode: 0o644,
    content: `[Desktop Entry]
Type=Application
Name=PrioriCode Clipboard Bridge
Exec=${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ")}
Terminal=false
X-GNOME-Autostart-enabled=true
`,
  }
}

export function bridgeExecArgs(): string[] {
  const entry = process.argv[1] ?? ""
  const script = /\.(m?[jt]sx?|cjs)$/.test(entry)
  return script ? [process.execPath, entry, "paste-serve"] : [process.execPath, "paste-serve"]
}

async function installRemoteForward(port: number): Promise<"added" | "updated" | "present" | "failed"> {
  const file = path.join(os.homedir(), ".ssh", "config")
  let existing = ""
  try {
    existing = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return ""
      throw error
    })
  } catch {
    return "failed"
  }
  const hadMarker = existing.includes(SSH_BRIDGE_MARKER)
  const result = ensureRemoteForward(existing, port)
  if (!result.changed) return "present"
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, result.text, "utf8")
  } catch {
    return "failed"
  }
  return hadMarker ? "updated" : "added"
}

async function installAutostart(): Promise<"installed" | "failed"> {
  const target = autostartTarget(process.platform, os.homedir(), bridgeExecArgs())
  try {
    if (target.kind === "registry") {
      const result = spawnSync("reg.exe", target.regArgs ?? [], { stdio: "ignore" })
      return result.status === 0 ? "installed" : "failed"
    }
    if (target.path === undefined || target.content === undefined) return "failed"
    await mkdir(path.dirname(target.path), { recursive: true })
    await writeFile(target.path, target.content, { mode: target.mode })
    return "installed"
  } catch {
    return "failed"
  }
}

export const PasteServeCommand = {
  command: "paste-serve",
  describe: "share this machine's clipboard with remote PrioriCode TUI sessions (text and images, any terminal)",
  builder: (yargs: Argv) =>
    yargs
      .option("port", {
        describe: "loopback port to serve the clipboard on",
        type: "number",
        default: PASTE_BRIDGE_DEFAULT_PORT,
      })
      .option("setup", {
        describe:
          "one-time: also write the ssh RemoteForward into ~/.ssh/config and start this bridge automatically at login",
        type: "boolean",
        default: false,
      }),
  handler: async (args: { port: number; setup: boolean }) => {
    if (args.setup) {
      const forward = await installRemoteForward(args.port)
      if (forward === "added") UI.println(`~/.ssh/config: forwarding ${args.port} to all hosts`)
      else if (forward === "updated") UI.println(`~/.ssh/config: forward port updated to ${args.port}`)
      else if (forward === "present") UI.println(`~/.ssh/config: already forwarding port ${args.port}`)
      else UI.println(`could not edit ~/.ssh/config — add 'RemoteForward ${args.port} localhost:${args.port}' manually`)
      const autostart = await installAutostart()
      UI.println(
        autostart === "installed"
          ? "bridge will start automatically at login — you never need to run this again"
          : "could not install login autostart — add prioricode paste-serve to your startup apps",
      )
      UI.println("Reconnect existing ssh sessions so the forward is established.")
    }
    const server = http.createServer(async (request, response) => {
      if (request.method !== "GET" || (request.url !== "/clipboard" && request.url !== "/")) {
        response.writeHead(404).end()
        return
      }
      const content = await read().catch(() => undefined)
      const payload = clipboardPayload(content)
      if (payload === undefined) {
        response.writeHead(204).end()
        return
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload))
    })
    server.listen(args.port, "127.0.0.1", () => {
      UI.println(`prioricode paste-serve: sharing this machine's clipboard on 127.0.0.1:${args.port}`)
      if (!args.setup) {
        UI.println("One-time automatic setup (ssh forward + login start): prioricode paste-serve --setup")
        UI.println(
          `Or manually: add 'RemoteForward ${args.port} localhost:${args.port}' to ~/.ssh/config, then reconnect ssh.`,
        )
      }
      UI.println("Then Ctrl+V in a remote PrioriCode TUI pastes this machine's clipboard, images included.")
    })
    const shutdown = () =>
      server.close(() => {
        process.exit(0)
      })
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
    await new Promise<void>((resolve) => server.on("close", resolve))
  },
}
