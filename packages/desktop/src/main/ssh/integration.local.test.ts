import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bootstrapScript, parseBootstrapMarker, sshBaseArgs, stopScript, type SshBootstrapResult } from "./commands"

function sshOk() {
  try {
    return spawnSync("ssh", [...sshBaseArgs(), "localhost", "true"], { timeout: 10_000 }).status === 0
  } catch {
    return false
  }
}

const canSshLocalhost = sshOk()

function remoteScript(home: string, script: string): Promise<{ output: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const { spawn } = require("node:child_process") as typeof import("node:child_process")
    const child = spawn(
      "ssh",
      [...sshBaseArgs(), "localhost", "env", `HOME=${home}`, `PATH=${process.env.PATH ?? "/usr/bin:/bin"}`, "sh", "-s"],
      { stdio: ["pipe", "pipe", "pipe"] },
    )
    let output = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => (output += chunk))
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => (output += chunk))
    child.stdin.end(script)
    child.once("error", reject)
    child.once("exit", (code) => resolve({ output, code }))
  })
}

async function health(port: number, password: string): Promise<number> {
  const auth = Buffer.from(`prioricode:${password}`).toString("base64")
  for (const path of ["/api/health", "/global/health"]) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(3_000),
      })
      if (response.status === 404) continue
      return response.status
    } catch {
      return 0
    }
  }
  return 404
}

const waitFor = async (check: () => Promise<boolean>, ms: number) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

function expectBoot(output: string, stage: string): SshBootstrapResult {
  const parsed = parseBootstrapMarker(output)
  if ("code" in parsed) throw new Error(`${stage} bootstrap error ${parsed.code}: ${output.slice(-600)}`)
  return parsed
}

test(
  "real sshd loopback: bootstrap a genuine prioricode serve, reuse it, then stop it",
  async () => {
    if (!canSshLocalhost) return
    const home = mkdtempSync(join(tmpdir(), "pc-ssh-e2e-"))
    const firstPassword = "e2e-password-one"
    try {
      const first = expectBoot((await remoteScript(home, bootstrapScript(firstPassword))).output, "initial")
      expect(first.reused).toBeFalse()
      expect(first.password).toBe(firstPassword)
      expect(first.port).toBeGreaterThan(0)

      expect(await waitFor(() => health(first.port, firstPassword).then((status) => status === 200), 60_000)).toBeTrue()
      expect(await health(first.port, "wrong-password")).toBe(401)

      const reused = expectBoot((await remoteScript(home, bootstrapScript("e2e-password-two"))).output, "reuse")
      expect(reused.reused).toBeTrue()
      expect(reused.port).toBe(first.port)
      expect(reused.password).toBe(firstPassword)

      await remoteScript(home, stopScript())
      expect(await waitFor(async () => (await health(first.port, firstPassword)) === 0, 20_000)).toBeTrue()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  },
  180_000,
)
