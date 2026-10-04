import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  bootstrapArgs,
  bootstrapScript,
  installArgs,
  parseBootstrapMarker,
  parseListeningLine,
  probeArgs,
  SSH_BOOTSTRAP_MARKER,
  stopArgs,
  stopScript,
  tunnelArgs,
} from "./commands"

const PASSWORD = "9ec9a6a2-4a0f-4b1b-bc4c-4b3f5f0e1d2a"

test("every ssh argv vector addresses the alias verbatim and never carries the password", () => {
  const vectors = [
    probeArgs("my-host"),
    bootstrapArgs("my-host"),
    stopArgs("my-host"),
    tunnelArgs("my-host", 41000, 4096),
    installArgs("my-host", "0.1.18"),
    ...[bootstrapScript(PASSWORD)].map(() => bootstrapArgs("my-host")),
  ]
  for (const args of vectors) {
    const flat = args.join(" ")
    expect(flat).not.toContain(PASSWORD)
    expect(args).toContain("my-host")
  }
})

test("bootstrap uses BatchMode, timeout, accept-new host keys", () => {
  const args = bootstrapArgs("web")
  expect(args).toEqual([
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "web",
    "sh",
    "-s",
  ])
})

test("tunnel binds loopback both sides with fail-fast and keepalive options", () => {
  const args = tunnelArgs("web", 41234, 4096)
  const forward = args[args.indexOf("-L") + 1]
  expect(forward).toBe("127.0.0.1:41234:127.0.0.1:4096")
  expect(args).toContain("-N")
  expect(args).toContain("ExitOnForwardFailure=yes")
  expect(args.some((a) => a.startsWith("ServerAliveInterval="))).toBeTrue()
})

test("bootstrap script embeds the password only as a shell assignment and is POSIX sh", () => {
  const script = bootstrapScript(PASSWORD)
  expect(script).toContain(`PW='${PASSWORD}'`)
  expect(script).toContain("set -eu")
  expect(script).toContain("nohup")
  expect(script).toContain("--hostname 127.0.0.1 --port 0")
  expect(script).toContain(SSH_BOOTSTRAP_MARKER)
  for (const bashism of ["<<<", "[[ ", "echo -e"]) expect(script).not.toContain(bashism)
})

test("bootstrap script escapes single quotes in the password", () => {
  const script = bootstrapScript("ab'cd")
  expect(script).toContain(`PW='ab'"'"'cd'`)
})

test("stop script is idempotent", () => {
  const script = stopScript()
  expect(script).toContain('kill "$(cat "$D/pid")"')
  expect(script).toContain("2>/dev/null || true")
})

test("install pins the desktop app version", () => {
  const args = installArgs("web", "0.1.18")
  expect(args.at(-1)).toContain("curl -fsSL https://prioricode.ai/install | bash -s -- --version '0.1.18'")
})

test("marker parsing tolerates shell noise", () => {
  const out = [
    "mesg: ttyname failed: Inappropriate ioctl for device",
    `${SSH_BOOTSTRAP_MARKER} {"port":4096,"version":"0.1.18","password":"${PASSWORD}","reused":false}`,
    "",
  ].join("\n")
  expect(parseBootstrapMarker(out)).toEqual({
    port: 4096,
    version: "0.1.18",
    password: PASSWORD,
    reused: false,
  })
})

test("marker parsing reports structured errors", () => {
  expect(parseBootstrapMarker("PRIORICODE_SSH_BOOTSTRAP_ERROR missing_binary")).toEqual({ code: "missing_binary" })
  expect(parseBootstrapMarker("nothing here")).toEqual({ code: "no_marker" })
  expect(parseBootstrapMarker(`${SSH_BOOTSTRAP_MARKER} {bad json`)).toEqual({ code: "bad_marker" })
  expect(parseBootstrapMarker(`${SSH_BOOTSTRAP_MARKER} {"port":0,"password":"x"}`)).toEqual({ code: "bad_marker" })
  expect(parseBootstrapMarker(`${SSH_BOOTSTRAP_MARKER} {"port":4096,"password":""}`)).toEqual({ code: "bad_marker" })
})

test("marker roundtrips against a locally generated password", () => {
  const password = randomUUID()
  const line = `${SSH_BOOTSTRAP_MARKER} {"port":1234,"version":"","password":"${password}","reused":true}`
  const parsed = parseBootstrapMarker(line)
  expect("port" in parsed && parsed.port).toBe(1234)
  expect("password" in parsed && parsed.password).toBe(password)
})

test("listening line parser extracts host and port", () => {
  expect(parseListeningLine("prioricode server listening on http://127.0.0.1:4096")).toEqual({
    hostname: "127.0.0.1",
    port: 4096,
  })
  expect(parseListeningLine("prioricode server listening on http://0.0.0.0:4096")).toEqual({
    hostname: "0.0.0.0",
    port: 4096,
  })
  expect(parseListeningLine("no noise here")).toBeNull()
})
