import { createContext, type JSX, useContext } from "solid-js"
import {
  clipboardImageHint,
  clipboardInstallPlan,
  installClipboardSupport,
  read,
  write,
  type ClipboardInstallPlan,
  type TerminalOwner,
} from "../clipboard"

export type ClipboardContent = Readonly<{ data: string; mime: string }>
export type ClipboardService = Readonly<{
  read?(): Promise<ClipboardContent | undefined>
  write?(text: string): Promise<void>
  imageHint?(): string | undefined
  installPlan?(): ClipboardInstallPlan | undefined
  install?(terminal: TerminalOwner): Promise<{ ok: boolean; message: string }>
}>
const clipboard = {
  read,
  write,
  imageHint: clipboardImageHint,
  installPlan: clipboardInstallPlan,
  install: installClipboardSupport,
}
const ClipboardContext = createContext<ClipboardService>(clipboard)

export function ClipboardProvider(props: { value?: ClipboardService; children: JSX.Element }) {
  return <ClipboardContext.Provider value={props.value ?? clipboard}>{props.children}</ClipboardContext.Provider>
}

export function useClipboard() {
  return useContext(ClipboardContext)
}
