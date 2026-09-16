import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  PRIORICODE_CHANNEL: process.env["PRIORICODE_CHANNEL"],
  PRIORICODE_BUMP: process.env["PRIORICODE_BUMP"],
  PRIORICODE_VERSION: process.env["PRIORICODE_VERSION"],
  PRIORICODE_RELEASE: process.env["PRIORICODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.PRIORICODE_CHANNEL) return env.PRIORICODE_CHANNEL
  if (env.PRIORICODE_BUMP) return "latest"
  if (env.PRIORICODE_VERSION && !env.PRIORICODE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.PRIORICODE_VERSION) return env.PRIORICODE_VERSION
  if (IS_PREVIEW) {
    const hash = await $`git rev-parse --short HEAD`.text().then((x) => x.trim())
    return hash
  }
  const version = await fetch("https://registry.npmjs.org/prioricode-ai/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.PRIORICODE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "prioricode", "prioricode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.PRIORICODE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`prioricode script`, JSON.stringify(Script, null, 2))
