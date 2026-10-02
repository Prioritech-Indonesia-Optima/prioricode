import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import { shouldBootstrap } from "../../src/cli/paste-auto"
import { markerPath, readMarker, writeMarker } from "../../src/cli/paste-marker"

describe("paste bridge bootstrap decision", () => {
  const exec = "/usr/bin/prioricode paste-serve"

  test("skips remote/headless hosts", () => {
    expect(shouldBootstrap({ SSH_CONNECTION: "1.2.3.4 5 6" }, "linux", "5.15", undefined, exec)).toBe(false)
    expect(shouldBootstrap({}, "linux", "5.15", undefined, exec)).toBe(false)
  })

  test("runs on desktops", () => {
    expect(shouldBootstrap({}, "win32", "10.0", undefined, exec)).toBe(true)
    expect(shouldBootstrap({}, "darwin", "24.0", undefined, exec)).toBe(true)
    expect(shouldBootstrap({ DISPLAY: ":0" }, "linux", "6.0", undefined, exec)).toBe(true)
    expect(shouldBootstrap({ WSL_DISTRO_NAME: "ubuntu" }, "linux", "microsoft-standard", undefined, exec)).toBe(true)
  })

  test("fresh marker is a no-op, stale marker re-runs", () => {
    expect(shouldBootstrap({}, "win32", "10.0", { port: 48917, exec }, exec)).toBe(false)
    expect(shouldBootstrap({}, "win32", "10.0", { port: 48917, exec: "/old/path prioricode paste-serve" }, exec)).toBe(
      true,
    )
  })
})

describe("paste bridge marker", () => {
  test("round-trips through a temp home", async () => {
    const home = await mkdtemp(`${os.tmpdir()}/paste-marker-`)
    expect(await readMarker(home)).toBeUndefined()
    await writeMarker("/bin/prioricode paste-serve", 48917, home)
    expect(await readMarker(home)).toMatchObject({ port: 48917, exec: "/bin/prioricode paste-serve" })
    expect(markerPath(home)).toContain(".prioricode")
  })
})
