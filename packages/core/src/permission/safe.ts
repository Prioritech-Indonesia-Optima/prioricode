export * as SafeCommand from "./safe"

/**
 * Shell command classifier used by the ask-first approval mode. Two tiers run
 * without prompting: read-only inspection commands (they only observe state)
 * and repository verification suites (`bun test`, `npm test`, `pytest`, …),
 * which the harness actively wants to encourage and whose blast radius is the
 * repository itself. Everything else — including `git push`, package installs,
 * and any command with an unlisted program — still asks. Matching runs against
 * CommandArity-reduced patterns (`ls *`), never raw command text, so arguments
 * and flags cannot smuggle different programs past the classifier. A compound
 * command is safe only when every simple command in it is safe. Matching is performed against
 * CommandArity-reduced patterns (`ls *`), never raw command text, so arguments
 * and flags cannot smuggle different programs past the classifier. A compound
 * command is safe only when every simple command in it is safe.
 */

const SAFE_PROGRAMS = new Set([
  "arch",
  "basename",
  "cat",
  "cksum",
  "column",
  "comm",
  "cut",
  "date",
  "diff",
  "dirnames",
  "du",
  "echo",
  "env",
  "false",
  "file",
  "find",
  "gem which",
  "getent",
  "grep",
  "groups",
  "head",
  "hostname",
  "idf.py",
  "jq",
  "join",
  "kind get",
  "ls",
  "md5sum",
  "node --version",
  "npm ls",
  "npm view",
  "pdfinfo",
  "pgrep",
  "ps",
  "pv -n",
  "pwd",
  "readlink",
  "realpath",
  "rg",
  "sha1sum",
  "sha256sum",
  "sort",
  "stat",
  "strings",
  "systemctl is-active",
  "tac",
  "tail",
  "tr",
  "true",
  "uname",
  "uniq",
  "uptime",
  "wc",
  "which",
  "whoami",
  "xcodebuild -list",
  "xcodebuild -showbuildsettings",
  "poetry --version",
  "bun test",
  "bun run test",
  "npm test",
  "pnpm test",
  "yarn test",
  "deno test",
  "cargo test",
  "go test",
  "pytest",
  "make test",
  "mix test",
  "rspec",
  "dotnet test",
  "mvn test",
  "gradle test",
  "swift test",
  "dart test",
  "turbo test",
  "nx test",
  "poetry show",
  "podman image ls",
  "go version",
  "go env",
  "gcc --version",
  "g++ --version",
  "clang --version",
  "clang++ --version",
  "cmake --version",
  "pip show",
  "pip list",
  "bundle list",
  "bundle show",
  "gradle --version",
  "mvn --version",
  "sfdx --version",
  "sfdx plugins",
  "java -version",
])

const SAFE_GIT = new Set(["status", "branch", "log", "show", "diff", "blame", "describe", "rev-parse", "ls-files"])

/** Decide a CommandArity pattern (without its trailing `*`) or a raw prefix. */
export function isSafe(pattern: string): boolean {
  const trimmed = pattern.replace(/ \*$/, "").trim()
  if (trimmed === "") return false
  if (SAFE_PROGRAMS.has(trimmed)) return true
  const git = trimmed.match(/^git ([a-z-]+)$/)
  if (git?.[1] !== undefined) return SAFE_GIT.has(git[1])
  if (/^(cargo|cargo-deps)$/.test(trimmed)) return false
  const words = trimmed.split(/\s+/)
  const program = words[0] ?? ""
  // Version/help flags on any program only print information.
  if (words.length === 2 && (words[1] === "--version" || words[1] === "--help" || words[1] === "-h")) return true
  // Exact two-word subcommand entries are declared above; unknown multi-word
  // prefixes stay untrusted.
  return false
}
