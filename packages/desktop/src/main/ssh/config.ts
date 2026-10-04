import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

export type SshHostProfile = {
  alias: string
  hostname: string | null
  user: string | null
  port: number | null
  hasProxy: boolean
  sourceFile: string
}

export type SshConfigReadResult = {
  profiles: SshHostProfile[]
  files: { path: string; exists: boolean; error: string | null }[]
}

type Block = {
  patterns: string[]
  options: Map<string, string>
  file: string
}

const CAPTURED = new Set(["hostname", "user", "port", "proxyjump", "proxycommand"])
const MAX_INCLUDE_DEPTH = 2

export function sshConfigPath(home = defaultHome()) {
  return join(home, ".ssh", "config")
}

function defaultHome() {
  return process.platform === "win32" ? (process.env.USERPROFILE ?? homedir()) : homedir()
}

export function parseSshConfig(text: string, file = "ssh_config"): SshHostProfile[] {
  const blocks: Block[] = []
  parseBlocks(text, file, blocks, [], new Set<string>(), 0)
  return resolveProfiles(blocks)
}

export function readSshConfigProfiles(home = defaultHome()): SshConfigReadResult {
  const files: SshConfigReadResult["files"] = []
  const blocks: Block[] = []
  const visited = new Set<string>()
  collectBlocks(sshConfigPath(home), blocks, files, visited, 0)
  return { profiles: resolveProfiles(blocks), files }
}

function collectBlocks(path: string, blocks: Block[], files: SshConfigReadResult["files"], visited: Set<string>, depth: number) {
  const real = safeRealpath(path)
  if (visited.has(real) || depth > MAX_INCLUDE_DEPTH) return
  visited.add(real)
  let text: string
  try {
    if (!existsSync(path)) {
      files.push({ path, exists: false, error: null })
      return
    }
    text = readFileSync(path, "utf8")
    files.push({ path, exists: true, error: null })
  } catch (error) {
    files.push({ path, exists: false, error: error instanceof Error ? error.message : String(error) })
    return
  }
  parseBlocks(text, path, blocks, files, visited, depth)
}

function parseBlocks(text: string, file: string, blocks: Block[], files: SshConfigReadResult["files"], visited: Set<string>, depth: number) {
  let current: Block | undefined
  let inMatch = false
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const tokens = tokenizeLine(rawLine)
    if (!tokens.length) continue
    const keyword = tokens[0].keyword
    const values = tokens[0].values
    if (keyword === "host") {
      inMatch = false
      current = { patterns: values, options: new Map(), file }
      blocks.push(current)
      continue
    }
    if (keyword === "include") {
      inMatch = false
      current = undefined
      for (const target of values) {
        for (const included of expandInclude(target, file)) collectBlocks(included, blocks, files, visited, depth + 1)
      }
      continue
    }
    if (keyword === "match") {
      inMatch = true
      current = undefined
      continue
    }
    if (inMatch || !current) continue
    for (const token of tokens) {
      if (!CAPTURED.has(token.keyword)) continue
      if (!token.values.length) continue
      if (!current.options.has(token.keyword)) current.options.set(token.keyword, token.values[0])
    }
  }
}

type LineToken = { keyword: string; values: string[] }

function tokenizeLine(line: string): LineToken[] {
  const trimmed = stripComment(line.trim())
  if (!trimmed) return []
  const words = splitWords(trimmed)
  if (!words.length) return []
  let keyword = words[0]!
  let values = words.slice(1)
  while (values[0] === "=") values = values.slice(1)
  const eq = keyword.indexOf("=")
  if (eq >= 0) {
    const inline = keyword.slice(eq + 1)
    keyword = keyword.slice(0, eq)
    if (inline) values = [inline, ...values]
  }
  return [{ keyword: keyword.toLowerCase(), values }]
}

function stripComment(line: string) {
  let quote = ""
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (quote) {
      if (char === quote) quote = ""
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === "#" && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i).trim()
  }
  return line
}

function splitWords(line: string) {
  const words: string[] = []
  let current = ""
  let quote = ""
  let started = false
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = ""
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) words.push(current)
      current = ""
      started = false
      continue
    }
    current += char
    started = true
  }
  if (started) words.push(current)
  return words
}

function expandInclude(pattern: string, includingFile: string): string[] {
  let base = pattern
  if (base.startsWith("~/") || base === "~") base = join(defaultHome(), base.slice(2))
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(base) || base.startsWith("/")
  const full = isAbsolute ? base : resolve(dirname(includingFile), base)
  const parts = full.split(/[\\/]/)
  const last = parts[parts.length - 1] ?? ""
  if (!/[*?]/.test(last)) return [full]
  const dir = parts.slice(0, -1).join("/") || "/"
  try {
    return readdirSync(dir)
      .filter((name) => matchesGlob(name, last))
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

function matchesGlob(value: string, pattern: string) {
  let regex = ""
  for (const char of pattern) {
    if (char === "*") regex += ".*"
    else if (char === "?") regex += "."
    else regex += char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${regex}$`, "i").test(value)
}

function safeRealpath(path: string) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function resolveProfiles(blocks: Block[]): SshHostProfile[] {
  const aliases: { alias: string; file: string }[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    for (const pattern of block.patterns) {
      if (pattern.startsWith("!") || pattern.startsWith("-")) continue
      if (/[*?]/.test(pattern)) continue
      if (seen.has(pattern)) continue
      seen.add(pattern)
      aliases.push({ alias: pattern, file: block.file })
    }
  }
  return aliases.map(({ alias, file }) => {
    const merged = new Map<string, string>()
    for (const block of blocks) {
      if (!blockMatches(block, alias)) continue
      for (const [keyword, value] of block.options) {
        if (!merged.has(keyword)) merged.set(keyword, value)
      }
    }
    const port = Number.parseInt(merged.get("port") ?? "", 10)
    return {
      alias,
      hostname: merged.get("hostname") ?? alias,
      user: merged.get("user") ?? null,
      port: Number.isFinite(port) && port > 0 && port < 65536 ? port : null,
      hasProxy: merged.has("proxyjump") || merged.has("proxycommand"),
      sourceFile: file,
    }
  })
}

function blockMatches(block: Block, alias: string) {
  let positive = false
  for (const pattern of block.patterns) {
    if (pattern.startsWith("!")) {
      if (matchesGlob(alias, pattern.slice(1))) return false
      continue
    }
    if (matchesGlob(alias, pattern)) positive = true
  }
  return positive
}
