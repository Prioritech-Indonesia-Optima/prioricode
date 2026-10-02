// Zero-touch clipboard bridge bootstrap: on any desktop-like machine (the user's
// laptop), the first prioricode invocation after an install or upgrade wires the
// ssh RemoteForward and login autostart by itself — the same actions as
// `paste-serve --setup`, so remote Ctrl+V works with no manual steps.
// Headless/remote hosts (SSH servers, containers without a display) are skipped,
// and a marker file records what was installed so startup cost after the first
// run is one small file read.
import { spawn } from "node:child_process"
import net from "node:net"
import { homedir, release } from "node:os"
import { PASTE_BRIDGE_DEFAULT_PORT } from "@prioricode/tui/paste-bridge"
import { detectWsl } from "@prioricode/tui/clipboard"
import { bridgeExecArgs, installAutostart, installRemoteForward } from "./cmd/paste-serve"
import { readMarker, writeMarker, type BridgeMarker } from "./paste-marker"

export { markerPath, type BridgeMarker as Marker } from "./paste-marker"

export function shouldBootstrap(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  kernelRelease: string,
  marker: BridgeMarker | undefined,
  currentExec: string,
): boolean {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return false
  const desktop =
    platform === "win32" ||
    platform === "darwin" ||
    detectWsl(kernelRelease, env) ||
    env.DISPLAY !== undefined ||
    env.WAYLAND_DISPLAY !== undefined
  if (!desktop) return false
  if (marker && marker.port === PASTE_BRIDGE_DEFAULT_PORT && marker.exec === currentExec) return false
  return true
}

function portListening(port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1")
    const done = (value: boolean) => {
      socket.destroy()
      resolve(value)
    }
    socket
      .setTimeout(timeoutMs)
      .once("connect", () => done(true))
      .once("timeout", () => done(false))
      .once("error", () => done(false))
  })
}

export async function ensurePasteBridge(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  // Fully defensive: the bridge is an enhancement and must never break, slow,
  // or error a normal prioricode invocation.
  try {
    const home = homedir()
    const exec = bridgeExecArgs().join(" ")
    const marker = await readMarker(home)
    if (!shouldBootstrap(env, platform, release(), marker, exec)) return
    await installRemoteForward(PASTE_BRIDGE_DEFAULT_PORT)
    await installAutostart()
    if (!(await portListening(PASTE_BRIDGE_DEFAULT_PORT))) {
      const args = bridgeExecArgs()
      spawn(args[0], args.slice(1), { detached: true, stdio: "ignore" }).unref()
    }
    await writeMarker(exec, PASTE_BRIDGE_DEFAULT_PORT, home)
  } catch {}
}
