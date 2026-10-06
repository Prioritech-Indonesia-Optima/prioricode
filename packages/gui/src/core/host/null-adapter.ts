import type { HostAdapter } from "./adapter"

export function createNullAdapter(): HostAdapter {
  return {
    id: "web",
    capabilities: new Set(["host.clipboardImage"]),
    async openExternal(url: string) {
      globalThis.open(url, "_blank", "noopener")
    },
    async readClipboardImage() {
      const clipboard = globalThis.navigator?.clipboard
      const read = clipboard?.read
      if (read === undefined) return undefined
      try {
        const items = await read.call(clipboard)
        for (const item of items) {
          const type = item.types.find((candidate) => candidate.startsWith("image/"))
          if (type === undefined) continue
          const blob = await item.getType(type)
          const bytes = new Uint8Array(await blob.arrayBuffer())
          let binary = ""
          for (const byte of bytes) binary += String.fromCharCode(byte)
          return { mime: type, dataBase64: btoa(binary) }
        }
      } catch {
        return undefined
      }
      return undefined
    },
  }
}
