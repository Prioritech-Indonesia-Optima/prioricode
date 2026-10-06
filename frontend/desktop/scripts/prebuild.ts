#!/usr/bin/env bun
import { $ } from "bun"
import path from "path"
import { existsSync } from "node:fs"

import { downloadCliToResources, resolveChannel } from "./utils"

async function findRepoRoot(start: string): Promise<string> {
  let current = path.resolve(start)
  for (;;) {
    const pkgPath = path.join(current, "package.json")
    if (existsSync(pkgPath)) {
      try {
        const pkg = await Bun.file(pkgPath).json()
        if (pkg?.workspaces) return current
      } catch {}
    }
    const parent = path.dirname(current)
    if (parent === current) throw new Error(`Could not find repo root from ${start}`)
    current = parent
  }
}
const root = await findRepoRoot(import.meta.dirname)

// Resolve the CLI package's directory by name so this stays correct wherever it lives.
async function findPackageDir(root: string, name: string): Promise<string> {
  const pkg = await Bun.file(path.join(root, "package.json")).json()
  const globs = pkg?.workspaces?.packages ?? []
  for (const glob of globs) {
    for (const file of new Bun.Glob(`${glob}/package.json`).scanSync(root)) {
      try {
        const candidate = await Bun.file(path.join(root, file)).json()
        if (candidate?.name === name) return path.join(root, path.dirname(file))
      } catch {}
    }
  }
  throw new Error(`Workspace package not found: ${name}`)
}
const cliDir = await findPackageDir(root, "prioricode")

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ${cliDir} && bun script/build-node.ts`
if (channel === "dev") await downloadCliToResources()
