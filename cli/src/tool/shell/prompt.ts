import { Schema } from "effect"
import DESCRIPTION from "./shell.txt"
import { PositiveInt } from "@prioricode/core/schema"
import { Global } from "@prioricode/core/global"
import { ShellID } from "./id"

const PS = new Set(["powershell", "pwsh"])
const CMD = new Set(["cmd"])

export type Limits = {
  maxLines: number
  maxBytes: number
}

export function parameterSchema() {
  return Schema.Struct({
    command: Schema.String.annotate({ description: "The command to execute" }),
    timeout: Schema.optional(PositiveInt).annotate({
      description:
        "Optional timeout in milliseconds (default 120000). Use background: true for long-running work instead of raising this",
    }),
    workdir: Schema.optional(Schema.String).annotate({
      description: `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
    }),
    background: Schema.optional(Schema.Boolean).annotate({
      description:
        "Set true to launch the command in the background: the call returns immediately with a job id, the command keeps running, and you are notified automatically when it finishes. Use for servers, watchers, and long builds instead of large timeouts. Manage it with the jobs tool",
    }),
  })
}

export const Parameters = parameterSchema()
export type Parameters = Schema.Schema.Type<typeof Parameters>

function renderPrompt(template: string, values: Record<string, string>) {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`Missing shell prompt value: ${key}`)
    return value
  })
}

function shellDisplayName(name: string) {
  if (name === "pwsh") return "PowerShell (7+)"
  if (name === "powershell") return "Windows PowerShell (5.1)"
  if (name === "cmd") return "cmd.exe"
  return name
}

function powershellNotes(name: string) {
  if (name === "pwsh") {
    return `# PowerShell (7+) shell notes
- This cross-platform shell supports pipeline chain operators (\`&&\` and \`||\`).
- Use double quotes for interpolated strings (\`"Hello $name"\`), single quotes for verbatim strings.
- Prefer full cmdlet names like \`Get-ChildItem\`, \`Set-Content\`, \`Remove-Item\`, and \`New-Item\` over aliases.
- Use \`$(...)\` for subexpressions. Use \`@(...)\` for array expressions.
- To call a native executable whose path contains spaces, use the call operator: \`& "path/to/exe" args\`.
- Escape special characters with the PowerShell backtick character.`
  }
  if (name === "powershell") {
    return `# Windows PowerShell (5.1) shell notes
- Use \`cmd1; if ($?) { cmd2 }\` to chain dependent commands.
- Use double quotes for interpolated strings (\`"Hello $name"\`), single quotes for verbatim strings.
- Prefer full cmdlet names like \`Get-ChildItem\`, \`Set-Content\`, \`Remove-Item\`, and \`New-Item\` over aliases.
- Use \`$(...)\` for subexpressions. Use \`@(...)\` for array expressions.
- To call a native executable whose path contains spaces, use the call operator: \`& "path/to/exe" args\`.
- Escape special characters with the PowerShell backtick character.`
  }
  return ""
}

function chainGuidance(name: string) {
  if (name === "powershell")
    return "run dependent commands in a single call as `cmd1; if ($?) { cmd2 }` — Windows PowerShell 5.1 has no `&&`"
  if (PS.has(name))
    return 'run dependent commands in a single call with `&&` (e.g. `git add . && git commit -m "msg" && git push`)'
  if (CMD.has(name)) return "run dependent commands in a single call with `&&` (e.g. `mkdir out && dir out`)"
  return 'run dependent commands in a single call with `&&` (e.g. `git add . && git commit -m "msg" && git push`); steps that need earlier success must never be parallelized'
}

function commandSection(name: string, pathSep: string, chain: string, limits: Limits, defaultTimeoutMs: number) {
  const isPS = PS.has(name)
  const isCMD = CMD.has(name)
  const notes = isCMD
    ? `# cmd.exe notes
- Double-quote paths with spaces; \`%VAR%\` for environment variables.
- \`if exist\` for existence checks; \`call\` to invoke batch files from batch-style commands.`
    : isPS
      ? powershellNotes(name)
      : ""
  const avoid = isCMD
    ? "`more` or other pagination commands"
    : isPS
      ? "`Select-Object -First`/`-Last` or other truncation cmdlets"
      : "`head`, `tail`, or other truncation commands"
  const dedicated = isCMD
    ? "Glob (NOT `dir /s`), Grep (NOT findstr), Read (NOT `type`), Edit (NOT `copy`), Write (NOT `echo > file`)"
    : isPS
      ? "Glob (NOT Get-ChildItem), Grep (NOT Select-String), Read (NOT Get-Content), Edit (NOT Set-Content), Write (NOT Set-Content/Out-File or here-strings)"
      : "Glob (NOT `find`/`ls`), Grep (NOT `grep`/`rg`), Read (NOT `cat`/`head`/`tail`), Edit (NOT `sed`/`awk`), Write (NOT `echo >`/heredocs)"
  const check = isCMD
    ? `\`if exist\` the parent before creating \`foo${pathSep}bar\``
    : isPS
      ? `\`Test-Path -LiteralPath "foo"\` before creating \`foo${pathSep}bar\``
      : "`ls foo` before `mkdir foo/bar`"
  const failOK = isCMD ? "&" : ";"
  return [
    notes,
    `# Command rules
- \`command\` is required. \`timeout\` in ms, default ${defaultTimeoutMs}ms.
- Double-quote paths containing spaces — unquoted paths are split (\`del "path with spaces${pathSep}file.txt"\`).
- Verify the parent directory before creating there (${check}).
- Output past ${limits.maxLines} lines or ${limits.maxBytes} bytes is truncated and saved to a file — Read it with offset/limit or Grep it. Never self-truncate with ${avoid}.
- Dedicated tools beat shell equivalents: ${dedicated}. Communicate in plain response text, not echo/printf/Write-Output.
- Independent commands: multiple calls in one message (e.g. "git status" + "git diff"). Dependent commands: ${chain}.
- Use \`${failOK}\` only when earlier failures are acceptable. Bare newlines are not separators (inside quoted strings they are fine).`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function profile(name: string, platform: NodeJS.Platform, limits: Limits, defaultTimeoutMs: number) {
  const isPowerShell = PS.has(name)
  const chain = chainGuidance(name)
  if (CMD.has(name)) {
    return {
      intro: `Executes a given ${shellDisplayName(name)} command with optional timeout, ensuring proper handling and security measures.`,
      workdirSection:
        "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID changing directories inside the command - use `workdir` instead.",
      commandSection: commandSection(name, "\\", chain, limits, defaultTimeoutMs),
      gitCommands: "git commands",
      gitCommandRestriction: "git commands",
      createPrInstruction: "Create PR using a temporary body file so cmd.exe quoting stays simple.",
      createPrExample: `(\n  echo ## Summary\n  echo - ^<1-3 bullet points^>\n) > pr-body.txt\ngh pr create --title "the pr title" --body-file pr-body.txt`,
    }
  }
  if (isPowerShell) {
    return {
      intro: `Executes a given ${shellDisplayName(name)} command with optional timeout, ensuring proper handling and security measures.`,
      workdirSection:
        "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID changing directories inside the command - use `workdir` instead.",
      commandSection: commandSection(name, platform === "win32" ? "\\" : "/", chain, limits, defaultTimeoutMs),
      gitCommands: "git commands",
      gitCommandRestriction: "git commands",
      createPrInstruction: "Create PR using gh pr create with a PowerShell here-string to pass the body correctly.",
      createPrExample: `gh pr create --title "the pr title" --body @'
## Summary
- <1-3 bullet points>
'@`,
    }
  }
  return {
    intro:
      "Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.",
    workdirSection:
      "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID using `cd <directory> && <command>` patterns - use `workdir` instead.",
    commandSection: commandSection(name, "/", chain, limits, defaultTimeoutMs),
    gitCommands: "bash commands",
    gitCommandRestriction: "git bash commands",
    createPrInstruction:
      "Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.",
    createPrExample: `gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>`,
  }
}

export function render(name: string, platform: NodeJS.Platform, limits: Limits, defaultTimeoutMs: number) {
  const selected = profile(name, platform, limits, defaultTimeoutMs)
  return {
    description: renderPrompt(DESCRIPTION, {
      intro: selected.intro,
      os: platform,
      shell: name,
      tmp: Global.Path.tmp,
      workdirSection: selected.workdirSection,
      commandSection: selected.commandSection,
      gitCommands: selected.gitCommands,
      toolName: ShellID.ToolID,
      gitCommandRestriction: selected.gitCommandRestriction,
      createPrInstruction: selected.createPrInstruction,
      createPrExample: selected.createPrExample,
    }),
    parameters: parameterSchema(),
  }
}

export * as ShellPrompt from "./prompt"
