import { app, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import { randomUUID } from "node:crypto"
import type { SshServersController } from "./servers"
import { isValidSshAlias } from "./errors"
import { setGlobalAuthPromptHandler } from "./askpass"
import { nativeT } from "../native-translations"

function requireSshIpcString(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) {
    throw new Error(nativeT("desktop.ssh.error.invalidHost"))
  }
  if (name === "host alias" && !isValidSshAlias(value.trim()))
    throw new Error(nativeT("desktop.ssh.error.invalidAlias"))
  return value
}

export function registerSshIpcHandlers(controller: SshServersController) {
  const subscriptions = new Map<number, { off: () => void; sender: Electron.WebContents }>()
  const authPending = new Map<string, (answer: string | null) => void>()

  setGlobalAuthPromptHandler((prompt) => {
    return new Promise<string | null>((resolve) => {
      const requestId = randomUUID()
      authPending.set(requestId, (answer) => {
        authPending.delete(requestId)
        resolve(answer)
      })
      for (const { sender } of subscriptions.values()) {
        if (!sender.isDestroyed()) sender.send("ssh-auth-prompt", { requestId, prompt })
      }
      setTimeout(() => {
        const pending = authPending.get(requestId)
        if (!pending) return
        authPending.delete(requestId)
        pending(null)
      }, 130_000)
    })
  })

  ipcMain.handle("ssh-auth-respond", (_event: IpcMainInvokeEvent, requestId: unknown, answer: unknown) => {
    if (typeof requestId !== "string") return
    const pending = authPending.get(requestId)
    if (!pending) return
    pending(typeof answer === "string" ? answer : null)
  })
  const unsubscribe = (id: number) => {
    const entry = subscriptions.get(id)
    if (!entry) return
    entry.off()
    subscriptions.delete(id)
  }

  app.once("will-quit", () => {
    subscriptions.forEach((entry) => entry.off())
    subscriptions.clear()
  })

  ipcMain.handle("ssh-servers-subscribe", (event) => {
    const id = event.sender.id
    if (subscriptions.has(id)) return
    subscriptions.set(id, {
      sender: event.sender,
      off: controller.subscribe((payload) => {
        if (event.sender.isDestroyed()) {
          unsubscribe(id)
          return
        }
        event.sender.send("ssh-servers-event", payload)
      }),
    })
    event.sender.once("destroyed", () => unsubscribe(id))
  })
  ipcMain.handle("ssh-servers-unsubscribe", (event) => unsubscribe(event.sender.id))
  ipcMain.handle("ssh-servers-get-state", () => controller.getState())
  ipcMain.handle("ssh-servers-refresh-hosts", () => controller.refreshHosts())
  ipcMain.handle("ssh-servers-add", (_event: IpcMainInvokeEvent, alias: string, workspace?: unknown) =>
    controller.addServer(
      requireSshIpcString("host alias", alias),
      typeof workspace === "string" && workspace.trim() ? workspace : undefined,
    ),
  )
  ipcMain.handle("ssh-servers-set-workspace", (_event: IpcMainInvokeEvent, id: string, workspace: unknown) =>
    controller.setWorkspace(
      requireSshIpcString("server id", id),
      typeof workspace === "string" ? workspace : "",
    ),
  )
  ipcMain.handle("ssh-servers-remove", (_event: IpcMainInvokeEvent, id: string) =>
    controller.removeServer(requireSshIpcString("server id", id)),
  )
  ipcMain.handle("ssh-servers-start", (_event: IpcMainInvokeEvent, id: string) =>
    controller.startServer(requireSshIpcString("server id", id)),
  )
  ipcMain.handle("ssh-servers-stop", (_event: IpcMainInvokeEvent, id: string) =>
    controller.stopServer(requireSshIpcString("server id", id)),
  )
  ipcMain.handle("ssh-servers-install-prioricode", (_event: IpcMainInvokeEvent, alias: string) =>
    controller.installPrioricode(requireSshIpcString("host alias", alias)),
  )
}
