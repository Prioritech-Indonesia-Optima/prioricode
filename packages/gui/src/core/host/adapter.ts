export type HostCapability =
  | "host.openDiff"
  | "host.fileContext"
  | "host.selection"
  | "host.diagnostics"
  | "host.clipboardImage"
  | "host.runCommand"
  | "host.nativeTheme"

export interface FileContext {
  path: string
  languageId?: string
  text?: string
}

export interface SelectionContext {
  path: string
  start: number
  end: number
  text: string
}

export interface DiffRequest {
  file: string
  title?: string
  before?: string
  after?: string
}

export interface ClipboardImage {
  mime: string
  dataBase64: string
}

/**
 * Environment-plane seam. Everything product-side (editor integration, OS
 * clipboard, external links) goes through this interface; components feature
 * detect via `capabilities` instead of branching on a host name.
 */
export interface HostAdapter {
  readonly id: "web" | "vscode"
  readonly capabilities: ReadonlySet<HostCapability>
  openExternal(url: string): Promise<void>
  openDiff?(request: DiffRequest): Promise<void>
  getFileContext?(): Promise<FileContext | undefined>
  getActiveSelection?(): Promise<SelectionContext | undefined>
  readClipboardImage?(): Promise<ClipboardImage | undefined>
  runCommand?(command: string, ...args: unknown[]): Promise<void>
}
