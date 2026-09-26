export * as LSPServer from "./server"

import { existsSync } from "node:fs"
import path from "node:path"
import { Npm } from "../npm"
import { Module } from "../util/module"
import { which } from "../util/which"
import { ConfigLSP } from "../config/lsp"
import { LSPJSONRPC } from "./jsonrpc"

export interface Launch {
  readonly command: ReadonlyArray<string>
  readonly env?: Record<string, string>
  readonly initialization?: Record<string, unknown>
}

export interface Definition {
  readonly id: string
  /** Lowercased extensions this server handles; empty means every file. */
  readonly extensions: ReadonlyArray<string>
  /** Server workspace root for a file, bounded by the Location directory. */
  readonly root: (file: string, directory: string) => Promise<string>
  /** Resolve a spawnable server, or `undefined` when the toolchain is absent. */
  readonly spawn: (root: string, directory: string) => Promise<Launch | undefined>
}

function matches(definition: Definition, file: string) {
  if (definition.extensions.length === 0) return true
  return definition.extensions.includes(LSPJSONRPC.pathExtname(file))
}

function nearest(markers: ReadonlyArray<string>) {
  return async (file: string, directory: string) => {
    let current = path.dirname(file)
    for (;;) {
      for (const marker of markers) if (existsSync(path.join(current, marker))) return current
      if (current === directory || current === path.dirname(current)) return directory
      current = path.dirname(current)
    }
  }
}

const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]

export const typescript: Definition = {
  id: "typescript",
  extensions: TYPESCRIPT_EXTENSIONS,
  root: nearest([
    "package.json",
    "package-lock.json",
    "bun.lock",
    "bun.lockb",
    "pnpm-lock.yaml",
    "yarn.lock",
    "jsconfig.json",
    "tsconfig.json",
  ]),
  async spawn(root, directory) {
    const tsserver =
      Module.resolve("typescript/lib/tsserver.js", root) ?? Module.resolve("typescript/lib/tsserver.js", directory)
    if (!tsserver) return undefined
    const bin = which("typescript-language-server") ?? (await Npm.which("typescript-language-server"))
    if (!bin) return undefined
    return { command: [bin, "--stdio"], initialization: { tsserver: { path: tsserver } } }
  },
}

export const python: Definition = {
  id: "python",
  extensions: [".py", ".pyi"],
  root: nearest(["pyproject.toml", "setup.py", "requirements.txt", "Pipfile", "uv.lock"]),
  async spawn() {
    const bin =
      which("pyright-langserver") ??
      which("basedpyright-langserver") ??
      (await Npm.which("pyright", "pyright-langserver")) ??
      (await Npm.which("basedpyright", "basedpyright-langserver"))
    if (!bin) return undefined
    return { command: [bin, "--stdio"] }
  },
}

export const go: Definition = {
  id: "go",
  extensions: [".go"],
  root: nearest(["go.mod", "go.work"]),
  async spawn() {
    const bin = which("gopls")
    if (!bin) return undefined
    return { command: [bin, "serve"] }
  },
}

export const rust: Definition = {
  id: "rust",
  extensions: [".rs"],
  root: nearest(["Cargo.toml"]),
  async spawn() {
    const bin = which("rust-analyzer")
    if (!bin) return undefined
    return { command: [bin] }
  },
}

export const builtin: ReadonlyArray<Definition> = [typescript, python, go, rust]

export function fromConfig(id: string, server: ConfigLSP.Server): Definition {
  return {
    id,
    extensions: (server.extensions ?? []).map((extension) => extension.toLowerCase()),
    root: async (_file, directory) => directory,
    spawn: async () => ({ command: server.command, env: server.env, initialization: server.initialization }),
  }
}

export interface Registry {
  readonly enabled: boolean
  readonly definitions: ReadonlyArray<Definition>
}

/** Built-ins merged with config overrides. `lsp: false` disables everything; a `disabled: true` entry removes that server. */
export function registry(config: typeof ConfigLSP.Info.Type | undefined): Registry {
  if (config === false) return { enabled: false, definitions: [] }
  const servers = new Map<string, Definition>(builtin.map((definition) => [definition.id, definition]))
  if (config !== undefined && typeof config === "object")
    for (const [name, entry] of Object.entries<typeof ConfigLSP.Entry.Type | typeof ConfigLSP.Disabled.Type>(config)) {
      if ("command" in entry) {
        if (entry.disabled === true) servers.delete(name)
        else servers.set(name, fromConfig(name, entry))
        continue
      }
      servers.delete(name)
    }
  return { enabled: true, definitions: Array.from(servers.values()) }
}

export function serverFor(registry: Registry, file: string) {
  if (!registry.enabled) return undefined
  return registry.definitions.find((definition) => matches(definition, file))
}
