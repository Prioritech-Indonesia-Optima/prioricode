import { $ } from "bun"
import path from "path"
import { existsSync } from "node:fs"
import { downloadCliToResources } from "./utils"

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

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.PRIORICODE_CHANNEL ?? "dev"}`

await $`cd ${path.join(root, "cli")} && bun script/build-node.ts`
await downloadCliToResources()
