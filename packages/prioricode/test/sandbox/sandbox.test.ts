import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Sandbox } from "@/sandbox"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const standard = (command: ChildProcess.Command) => {
  if (command._tag !== "StandardCommand") throw new Error("expected StandardCommand")
  return command
}

const bwrap = Sandbox.bwrapArgs({
  command: "echo hi",
  shell: "/bin/bash",
  network: "allow",
  writable: ["/work/tree", "/work/tree", "/data", "/tmp"],
})

describe("sandbox.bwrapArgs", () => {
  test("roots the filesystem read-only with device mounts", () => {
    expect(bwrap.slice(0, 7)).toEqual(["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"])
  })

  test("binds every unique writable path read-write", () => {
    const binds: string[] = []
    for (let i = 0; i < bwrap.length - 2; i++) {
      if (bwrap[i] === "--bind") binds.push(bwrap[i + 1])
    }
    expect(binds).toEqual(["/work/tree", "/data", "/tmp"])
  })

  test("never binds the root as writable", () => {
    const args = Sandbox.bwrapArgs({ command: "x", shell: "/bin/sh", network: "allow", writable: ["/"] })
    for (let i = 0; i < args.length - 2; i++) {
      expect(args[i] === "--bind" && args[i + 1] === "/").toBe(false)
    }
  })

  test("unshares user/pid/ipc/uts namespaces", () => {
    for (const flag of ["--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--die-with-parent"]) {
      expect(bwrap).toContain(flag)
    }
    expect(bwrap).not.toContain("--unshare-net")
  })

  test("unshares the network when denied", () => {
    const args = Sandbox.bwrapArgs({ command: "x", shell: "/bin/sh", network: "deny", writable: ["/tmp"] })
    expect(args).toContain("--unshare-net")
  })

  test("runs the shell command after the separator", () => {
    expect(bwrap.slice(-5)).toEqual(["--die-with-parent", "--", "/bin/bash", "-c", "echo hi"])
  })
})

describe("sandbox.seatbeltProfile", () => {
  const profile = Sandbox.seatbeltProfile({ network: "allow", writable: ["/work/tree", "/data"] })

  test("denies by default and scopes writes to the writable list", () => {
    expect(profile).toContain("(version 1)")
    expect(profile).toContain("(deny default)")
    expect(profile).toContain('(allow file-write* (subpath "/work/tree") (subpath "/data"))')
  })

  test("allows reads, process spawn, and sysctl reads", () => {
    expect(profile).toContain("(allow file-read*)")
    expect(profile).toContain("(allow process*)")
    expect(profile).toContain("(allow sysctl-read)")
  })

  test("allows network only when configured", () => {
    expect(profile).toContain("(allow network*)")
    expect(Sandbox.seatbeltProfile({ network: "deny", writable: ["/x"] })).not.toContain("(allow network*)")
  })

  test("escapes quotes in paths", () => {
    expect(Sandbox.seatbeltProfile({ network: "allow", writable: ['/a"b'] })).toContain('(subpath "/a\\"b")')
  })

  test("denies all writes when there are no writable paths", () => {
    expect(Sandbox.seatbeltProfile({ network: "allow", writable: [] })).toContain("(deny file-write*)")
  })
})

describe("sandbox.probeCapability", () => {
  it.effect("win32 reports unsupported", () =>
    Effect.gen(function* () {
      const cap = yield* Sandbox.probeCapability({
        platform: "win32",
        exists: () => Effect.succeed(true),
        run: () => Effect.die(new Error("must not spawn")),
      })()
      expect(cap.supported).toBe(false)
      if (cap.supported) return
      expect(cap.reason).toContain("Windows")
    }),
  )

  it.effect("darwin uses seatbelt when sandbox-exec exists", () =>
    Effect.gen(function* () {
      const cap = yield* Sandbox.probeCapability({
        platform: "darwin",
        exists: (file) => Effect.succeed(file === "/usr/bin/sandbox-exec"),
        run: () => Effect.die(new Error("must not spawn")),
      })()
      expect(cap).toEqual({ supported: true, backend: "seatbelt" })
    }),
  )

  it.effect("darwin reports a precise reason when sandbox-exec is missing", () =>
    Effect.gen(function* () {
      const cap = yield* Sandbox.probeCapability({
        platform: "darwin",
        exists: () => Effect.succeed(false),
        run: () => Effect.die(new Error("must not spawn")),
      })()
      expect(cap.supported).toBe(false)
      if (cap.supported) return
      expect(cap.reason).toContain("sandbox-exec was not found")
    }),
  )

  it.effect("linux runs a ground-truth bwrap spawn", () =>
    Effect.gen(function* () {
      const calls: string[][] = []
      const cap = yield* Sandbox.probeCapability({
        platform: "linux",
        exists: () => Effect.succeed(false),
        run: (command) => {
          const cmd = standard(command)
          calls.push([cmd.command, ...cmd.args])
          return Effect.succeed({ exitCode: 0, stderr: "" })
        },
      })()
      expect(cap).toEqual({ supported: true, backend: "bwrap" })
      expect(calls.length).toBe(1)
      expect(calls[0][0]).toBe("bwrap")
      expect(calls[0]).toContain("--unshare-user")
      expect(calls[0][calls[0].length - 1]).toBe("true")
    }),
  )

  it.effect("linux bwrap non-zero exit includes stderr detail", () =>
    Effect.gen(function* () {
      const cap = yield* Sandbox.probeCapability({
        platform: "linux",
        exists: () => Effect.succeed(false),
        run: () => Effect.succeed({ exitCode: 1, stderr: "bwrap: No permissions to create new namespace" }),
      })()
      expect(cap.supported).toBe(false)
      if (cap.supported) return
      expect(cap.reason).toContain("No permissions to create new namespace")
      expect(cap.reason).toContain("unprivileged user namespaces")
    }),
  )

  it.effect("linux bwrap spawn failure is reported, not swallowed", () =>
    Effect.gen(function* () {
      const cap = yield* Sandbox.probeCapability({
        platform: "linux",
        exists: () => Effect.succeed(false),
        run: () => Effect.fail(new Error("ENOENT bwrap")),
      })()
      expect(cap.supported).toBe(false)
      if (cap.supported) return
      expect(cap.reason).toContain("ENOENT bwrap")
    }),
  )
})
