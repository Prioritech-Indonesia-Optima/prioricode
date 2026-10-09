import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { createAskpassSession } from "./askpass"

const skipOnWindows = process.platform === "win32" ? test.skip : test

describe("askpass session", () => {
  skipOnWindows("helper prints the answered secret on stdout", async () => {
    const session = await createAskpassSession(async (prompt) => {
      expect(prompt).toContain("Password:")
      return "hunter2"
    })
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const child = spawn(session.env.SSH_ASKPASS, ["(aiadmin@host) Password: "], {
          env: { ...process.env, ...session.env },
        })
        let data = ""
        child.stdout.setEncoding("utf8")
        child.stdout.on("data", (chunk: string) => (data += chunk))
        child.once("exit", (code) => (code === 0 ? resolve(data) : reject(new Error(`exit ${code}`))))
      })
      expect(out).toBe("hunter2\n")
    } finally {
      await session.dispose()
    }
  })

  skipOnWindows("cancelled prompt answers empty so ssh fails auth quickly", async () => {
    const session = await createAskpassSession(async () => null)
    try {
      const result = await new Promise<{ code: number | null; out: string }>((resolve) => {
        const child = spawn(session.env.SSH_ASKPASS, ["Password: "], {
          env: { ...process.env, ...session.env },
        })
        let data = ""
        child.stdout.setEncoding("utf8")
        child.stdout.on("data", (chunk: string) => (data += chunk))
        child.once("exit", (code) => resolve({ code, out: data }))
      })
      expect(result.code).toBe(0)
      expect(result.out).toBe("\n")
    } finally {
      await session.dispose()
    }
  })
})
