import { app, ipcMain } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { SshServersController } from "./servers"
import { isValidSshAlias } from "./errors"
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
  const subscriptions = new Map<number, () => void>()
  const unsubscribe = (id: number) => {
    const off = subscriptions.get(id)
    if (!off) return
    off()
    subscriptions.delete(id)
  }

  app.once("will-quit", () => {
    subscriptions.forEach((off) => off())
    subscriptions.clear()
  })

  ipcMain.handle("ssh-servers-subscribe", (event) => {
    const id = event.sender.id
    if (subscriptions.has(id)) return
    subscriptions.set(
      id,
      controller.subscribe((payload) => {
        if (event.sender.isDestroyed()) {
          unsubscribe(id)
          return
        }
        event.sender.send("ssh-servers-event", payload)
      }),
    )
    event.sender.once("destroyed", () => unsubscribe(id))
  })
  ipcMain.handle("ssh-servers-unsubscribe", (event) => unsubscribe(event.sender.id))
  ipcMain.handle("ssh-servers-get-state", () => controller.getState())
  ipcMain.handle("ssh-servers-refresh-hosts", () => controller.refreshHosts())
  ipcMain.handle("ssh-servers-add", (_event: IpcMainInvokeEvent, alias: string) =>
    controller.addServer(requireSshIpcString("host alias", alias)),
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
