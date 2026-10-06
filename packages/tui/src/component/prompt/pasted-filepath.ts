import { fileURLToPath } from "node:url"

// Windows drive and UNC shapes; pasted by Explorer copies, cmd, or WSL
// interop output.
function isWindowsPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")
}

function isPathShape(value: string) {
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~") ||
    isWindowsPath(value) ||
    (!/\s/.test(value) && /\.[A-Za-z0-9]{1,8}$/.test(value))
  )
}

/**
 * When pasted content is (only) a file path, return the resolved filesystem
 * path so the caller can attach it; return undefined for URLs and prose so
 * they are never probed against the filesystem.
 */
export function pastedFilepath(value: string, platform: string): string | undefined {
  const first = value.split(/\r?\n/)[0]?.trim() ?? value
  const stripped = first.replace(/^['"]+|['"]+$/g, "")
  if (stripped.startsWith("file://")) {
    if (platform === "win32") {
      // `file:///C:/shots/a.png` → `C:\shots\a.png` without leaning on the
      // host platform's URL decoder.
      const decoded = decodeURIComponent(stripped.slice("file://".length)).replace(/^\/(?=[A-Za-z]:)/, "")
      return decoded.length ? decoded.replace(/\//g, "\\") : undefined
    }
    try {
      return fileURLToPath(stripped)
    } catch {
      return
    }
  }
  if (/^(https?):\/\//.test(stripped)) return
  // Windows terminals can paste several quoted paths at once
  // (`"C:\shots\a.png" "C:\shots\b.png"`); use the first file. Inspect the
  // unstripped line because the outer quotes are already gone from `stripped`.
  if (platform === "win32" && first.startsWith('"')) {
    const end = first.indexOf('"', 1)
    if (end > 0 && isPathShape(first.slice(1, end))) return first.slice(1, end)
  }
  if (!isPathShape(stripped)) return
  if (platform === "win32") return stripped
  // Terminals escape path separators on POSIX tab-completion (`my\ file`),
  // but never touch genuine Windows shapes.
  if (isWindowsPath(stripped)) return stripped
  return stripped.replace(/\\(.)/g, "$1")
}
