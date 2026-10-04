import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseSshConfig, readSshConfigProfiles } from "./config"

function home(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "pc-ssh-config-"))
  const ssh = join(dir, ".ssh")
  mkdirSync(ssh, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const target = join(ssh, name)
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, content)
  }
  return dir
}

function parse(text: string) {
  const dir = home({ config: text })
  try {
    return readSshConfigProfiles(dir).profiles
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("parses simple host blocks with options", () => {
  const profiles = parse(`
# comment
Host web
  HostName web.example.com
  User deploy
  Port 2222

Host db
  HostName 10.0.0.5
  IdentityFile ~/.ssh/id_ed25519
`)
  expect(profiles).toEqual([
    { alias: "web", hostname: "web.example.com", user: "deploy", port: 2222, hasProxy: false, sourceFile: expect.any(String) },
    { alias: "db", hostname: "10.0.0.5", user: null, port: null, hasProxy: false, sourceFile: expect.any(String) },
  ])
})

test("multi-token Host lines emit one profile per alias", () => {
  const profiles = parse("Host alpha beta gamma\n  User shared\n")
  expect(profiles.map((p) => p.alias)).toEqual(["alpha", "beta", "gamma"])
  expect(profiles.every((p) => p.user === "shared")).toBeTrue()
})

test("wildcard blocks are never enumerable but merge in ssh first-obtained-wins order", () => {
  const profiles = parse(`
Host special
  User owner

Host *
  User global
  Port 2200
`)
  expect(profiles).toEqual([
    { alias: "special", hostname: "special", user: "owner", port: 2200, hasProxy: false, sourceFile: expect.any(String) },
  ])
})

test("literal-looking wildcard patterns are skipped, negations ignored", () => {
  const profiles = parse("Host prod-* !skip-me plain\n  User x\n")
  expect(profiles.map((p) => p.alias)).toEqual(["plain"])
})

test("negated pattern removes alias from wildcard block", () => {
  const profiles = parse("Host * !secret\n  User public\n\nHost secret\n  User hidden\n")
  const secret = profiles.find((p) => p.alias === "secret")
  expect(secret?.user).toBe("hidden")
})

test("supports Key=value syntax and quoted values", () => {
  const profiles = parse(`
Host kv
    User=bob
    HostName "name with spaces"
    Port = 2299
`)
  expect(profiles[0]).toEqual({
    alias: "kv",
    hostname: "name with spaces",
    user: "bob",
    port: 2299,
    hasProxy: false,
    sourceFile: expect.any(String),
  })
})

test("hash inside quoted value is not a comment", () => {
  const profiles = parse('Host q\n  User "a#b" # trailing comment\n')
  expect(profiles[0]?.user).toBe("a#b")
})

test("Match blocks are skipped without crashing", () => {
  const profiles = parse(`
Host kept
  User a
Match host *.internal
  User nope
Host kept2
  User b
`)
  expect(profiles.map((p) => [p.alias, p.user])).toEqual([
    ["kept", "a"],
    ["kept2", "b"],
  ])
})

test("Include files are expanded with depth cap and cycle guard", () => {
  const dir = home({
    config: "Include ./parts/*\nHost main\n  User m\n",
    "parts/a.conf": "Include ../loop.conf\nHost inc-a\n  User a\n",
    "parts/b.conf": "Host inc-b\n  ProxyJump main\n",
    "loop.conf": "Include ./config\n",
  })
  try {
    const profiles = readSshConfigProfiles(dir).profiles
    expect(profiles.map((p) => p.alias).sort()).toEqual(["inc-a", "inc-b", "main"])
    expect(profiles.find((p) => p.alias === "inc-b")?.hasProxy).toBeTrue()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("handles CRLF and missing file", () => {
  const profiles = parse("Host crlf\r\n  User u\r\n  Port 45\r\n")
  expect(profiles[0]).toEqual({
    alias: "crlf",
    hostname: "crlf",
    user: "u",
    port: 45,
    hasProxy: false,
    sourceFile: expect.any(String),
  })
  const missing = home({})
  try {
    expect(readSshConfigProfiles(missing).profiles).toEqual([])
  } finally {
    rmSync(missing, { recursive: true, force: true })
  }
})

test("invalid port values are dropped", () => {
  const profiles = parse("Host bad\n  Port abc\nHost over\n  Port 99999999\n")
  expect(profiles.find((p) => p.alias === "bad")?.port).toBeNull()
  expect(profiles.find((p) => p.alias === "over")?.port).toBeNull()
})

test("dedupes repeated alias keeping first block", () => {
  const profiles = parse("Host dup\n  User first\nHost dup\n  User second\n")
  expect(profiles.length).toBe(1)
  expect(profiles[0]?.user).toBe("first")
})

test("parseSshConfig is exported for raw text use", () => {
  expect(typeof parseSshConfig).toBe("function")
})
