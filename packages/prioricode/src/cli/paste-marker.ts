import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { PASTE_BRIDGE_DEFAULT_PORT } from "@prioricode/tui/paste-bridge"

export type BridgeMarker = Readonly<{ port: number; exec: string }>

export function markerPath(home: string = homedir()): string {
  return path.join(home, ".prioricode", "paste-bridge.json")
}

export async function readMarker(home: string = homedir()): Promise<BridgeMarker | undefined> {
  try {
    return JSON.parse(await readFile(markerPath(home), "utf8")) as BridgeMarker
  } catch {
    return undefined
  }
}

export async function writeMarker(
  exec: string,
  port = PASTE_BRIDGE_DEFAULT_PORT,
  home: string = homedir(),
): Promise<void> {
  const file = markerPath(home)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ port, exec, at: Date.now() }), "utf8")
}
