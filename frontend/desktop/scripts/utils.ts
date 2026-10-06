import { $ } from "bun"
import { existsSync } from "node:fs"
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const CLI_VERSION = "0.0.0-next-16350"

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.PRIORICODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

export const CLI_BINARIES: Array<{ rustTarget: string; package: string; os: string; cpu: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    package: "@prioricode/cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    package: "@prioricode/cli-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-pc-windows-msvc",
    package: "@prioricode/cli-windows-arm64",
    os: "win32",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    package: "@prioricode/cli-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    package: "@prioricode/cli-linux-x64-baseline",
    os: "linux",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    package: "@prioricode/cli-linux-arm64",
    os: "linux",
    cpu: "arm64",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

function nativeTarget() {
  const { platform, arch } = process
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export function getCurrentCli(target = RUST_TARGET ?? nativeTarget()) {
  const binaryConfig = CLI_BINARIES.find((item) => item.rustTarget === target)
  if (!binaryConfig) throw new Error(`CLI configuration not available for target '${target}'`)

  return binaryConfig
}

async function findRepoRoot(start: string): Promise<string> {
  let current = start
  for (;;) {
    const pkgPath = join(current, "package.json")
    if (existsSync(pkgPath)) {
      try {
        const pkg = await Bun.file(pkgPath).json()
        if (pkg?.workspaces) return current
      } catch {}
    }
    const parent = dirname(current)
    if (parent === current) throw new Error(`Could not find repo root from ${start}`)
    current = parent
  }
}

export async function downloadCliToResources() {
  const cli = getCurrentCli()
  const directory = await mkdtemp(join(tmpdir(), "prioricode-cli-"))
  const dest = windowsify("resources/prioricode-cli")
  try {
    await $`bun install --no-save --cwd ${directory} ${`${cli.package}@${CLI_VERSION}`} ${`--os=${cli.os}`} ${`--cpu=${cli.cpu}`}`
    await copyFile(
      join(directory, "node_modules", cli.package, "bin", cli.os === "win32" ? "prioricode2.exe" : "prioricode2"),
      dest,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  if (process.platform !== "win32") await chmod(dest, 0o755)
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    const root = await findRepoRoot(import.meta.dirname)
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ${join(root, "script/sign-windows.ps1")} ${dest}`
  }
  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`

  console.log(`Copied ${cli.package} to ${dest}`)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
