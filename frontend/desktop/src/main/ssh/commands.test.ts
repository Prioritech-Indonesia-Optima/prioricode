import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  bootstrapArgs,
  checkArgs,
  checkScript,
  parseCheckMarker,
  SSH_CHECK_MARKER,
  bootstrapScript,
  installArgs,
  parseBootstrapMarker,
  parseListeningLine,
  probeArgs,
  selectBinary,
  compareVersions,
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

test("bootstrap allows interactive auth via askpass, with timeout and accept-new host keys", () => {
  const args = bootstrapArgs("web")
  expect(args).toEqual(["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new", "web", "sh", "-s"])
})

test("tunnel binds loopback both sides with fail-fast and keepalive options", () => {
  const args = tunnelArgs("web", 41234, 4096)
  const forward = args[args.indexOf("-L") + 1]
  expect(forward).toBe("127.0.0.1:41234:127.0.0.1:4096")
  expect(args).toContain("-N")
  expect(args).toContain("ExitOnForwardFailure=yes")
  expect(args.some((a) => a.startsWith("ServerAliveInterval="))).toBeTrue()
})

test("tunnel retry mode drops ExitOnForwardFailure but keeps the forward", () => {
  const args = tunnelArgs("web", 41234, 4096, false)
  expect(args).not.toContain("ExitOnForwardFailure=yes")
  expect(args[args.indexOf("-L") + 1]).toBe("127.0.0.1:41234:127.0.0.1:4096")
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
  expect(args.at(-1)).toContain(
    "set -o pipefail; curl -fsSL https://code.prioritech.co.id/install | bash -s -- --version '0.1.18'",
  )
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

test("check probe reports every candidate binary and parses the marker", () => {
  const script = checkScript()
  expect(script).toContain("set -eu")
  expect(script).toContain(SSH_CHECK_MARKER)
  expect(script).toContain("tr -cd")
  expect(checkArgs("web").join(" ")).not.toContain("Password")
  expect(
    parseCheckMarker(
      `${SSH_CHECK_MARKER} {"bins":[{"path":"/home/u/.local/bin/prioricode","version":"0.1.17"},{"path":"/home/u/bin/prioricode","version":"0.1.18"}]}`,
    ),
  ).toEqual({
    bins: [
      { path: "/home/u/.local/bin/prioricode", version: "0.1.17" },
      { path: "/home/u/bin/prioricode", version: "0.1.18" },
    ],
  })
  expect(parseCheckMarker("noise")).toEqual({ code: "no_marker" })
  expect(parseCheckMarker("PRIORICODE_SSH_BOOTSTRAP_ERROR missing_binary")).toEqual({ code: "missing_binary" })
})

test("selectBinary prefers the desktop-matching copy over a stale shadow", () => {
  const bins = [
    { path: "/home/u/.local/bin/prioricode", version: "0.2.6" },
    { path: "/home/u/bin/prioricode", version: "0.3.0" },
  ]
  expect(selectBinary(bins, "0.3.0")).toEqual(bins[1])
  expect(selectBinary(bins, "9.9.9")).toEqual(bins[1])
  expect(selectBinary([{ path: "/a", version: "" }], "0.3.0")).toEqual({ path: "/a", version: "" })
  expect(selectBinary([], "0.3.0")).toBeUndefined()
})

test("compareVersions orders numeric segments", () => {
  expect(compareVersions("0.3.0", "0.2.6")).toBeGreaterThan(0)
  expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0)
  expect(compareVersions("1.2.3", "1.2.3")).toBe(0)
})

test("bootstrap prefers the desktop-resolved binary path", () => {
  const script = bootstrapScript(PASSWORD, "/home/u/bin/prioricode")
  expect(script).toContain("/home/u/bin/prioricode")
  expect(script.indexOf('if [ -x "$PREF" ]')).toBeLessThan(script.indexOf('for c in "$HOME/.prioricode/bin'))
  expect(bootstrapScript(PASSWORD)).not.toContain("PREF=")
})
