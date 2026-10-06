import { PrioriCode } from "@prioricode/client"

export type GuiClient = ReturnType<typeof PrioriCode.make>

export interface GuiClientOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  headers?: HeadersInit
}

/**
 * Single construction seam for the generated typed client. Direct (browser) and
 * bridge (VS Code webview) transports differ only by injected `fetch`/headers.
 */
export function createGuiClient(options: GuiClientOptions): GuiClient {
  return PrioriCode.make(options)
}
