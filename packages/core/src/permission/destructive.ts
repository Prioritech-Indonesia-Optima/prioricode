export * as DestructiveCommand from "./destructive"

// Heuristic guard for the "always-allow" permission mode. It flags shell
// commands that can destroy the host system (wipe the root filesystem, reformat
// a disk, or power the machine off) so those still prompt even when everything
// else is auto-approved. It is intentionally conservative: a false negative
// just means an extra command runs unattended, while a false positive costs one
// prompt.

const SEPARATORS = /&&|\|\||;|\||\n/

const WRAPPERS = new Set(["sudo", "env", "nohup", "time", "command", "exec"])

const BLOCK_DEVICE =
  /\/dev\/(sd[a-z]+\d*|nvme\d+n\d+(p\d+)?|disk\d+|hd[a-z]+\d*|mmcblk\d+|xvd[a-z]+|dasd[a-z]+|dm-\d+)/

const REDIRECT_TO_BLOCK =
  />+\s*\/dev\/(sd[a-z]+\d*|nvme\d+n\d+(p\d+)?|disk\d+|hd[a-z]+\d*|mmcblk\d+|xvd[a-z]+|dasd[a-z]+|dm-\d+)/

const DANGEROUS_RM_TARGETS = new Set(["/", "/*", "~", "$HOME", "*", ".", "/."])

const DISK_TOOLS = new Set(["fdisk", "parted", "sgdisk", "gdisk", "wipefs"])

const POWER_TOOLS = new Set(["shutdown", "reboot", "halt", "poweroff"])

export function isDestructive(command: string): boolean {
  return command.split(SEPARATORS).some((segment) => isDestructiveSegment(segment.trim()))
}

function parseProgram(tokens: string[]): { program: string; rest: string[] } {
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    if (WRAPPERS.has(token) || token.startsWith("-")) {
      i++
      continue
    }
    return { program: token, rest: tokens.slice(i + 1) }
  }
  return { program: "", rest: [] }
}

function isDestructiveSegment(segment: string): boolean {
  if (!segment) return false
  const tokens = segment.split(/\s+/)
  const { program, rest } = parseProgram(tokens)
  const base = program.includes("/") ? program.slice(program.lastIndexOf("/") + 1) : program

  if (base === "rm") {
    const flags = rest.filter((token) => token.startsWith("-")).join("")
    const targets = rest.filter((token) => !token.startsWith("-"))
    if (/r|R/.test(flags) && /f/.test(flags) && targets.some((target) => DANGEROUS_RM_TARGETS.has(stripQuotes(target))))
      return true
  }

  if (base === "dd") {
    if (rest.some((token) => token.startsWith("of=") && BLOCK_DEVICE.test(token))) return true
  }

  if (base === "mkfs" || base.startsWith("mkfs.")) return true
  if (DISK_TOOLS.has(base)) return true
  if (POWER_TOOLS.has(base)) return true

  if (base === "init" && (rest[0] === "0" || rest[0] === "6")) return true
  if (base === "systemctl" && (rest[0] === "poweroff" || rest[0] === "reboot" || rest[0] === "halt")) return true

  if (base === "chmod" || base === "chown") {
    if (rest.some((token) => token === "-R" || token === "--recursive") && rest.includes("/")) return true
  }

  if (base === "find" && rest.includes("/") && rest.includes("-delete")) return true

  if (/:\(\)\{/.test(segment)) return true
  if (REDIRECT_TO_BLOCK.test(segment)) return true

  return false
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "")
}
