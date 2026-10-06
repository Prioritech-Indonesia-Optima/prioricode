// Windows PowerShell resolution chain for self-update. Windows 11 24H2+ can
// remove Windows PowerShell 5.1 as an optional feature and containers may
// lack it from PATH entirely, so the hardcoded `powershell.exe` spawn turned
// those machines into unexplained `exit code 1` upgrades. Preference order is
// deliberate: PATH powershell.exe first (present on every desktop SKU that
// still ships it, and the only shell guaranteed alongside the desktop
// assemblies install.ps1 needs), then the absolute System32 copy, then pwsh 7.

export function windowsShellCandidates(env: Readonly<Record<string, string | undefined>>): string[] {
  const systemRoot = (env.SystemRoot ?? env.windir ?? "C:\\Windows").replace(/[\\/]+$/, "")
  const absolute = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  return ["powershell.exe", absolute, "pwsh"].filter((candidate, index, all) => all.indexOf(candidate) === index)
}

// ChildProcess spawn failures for a missing executable surface as ENOENT in
// the captured error text; anything else means the shell really ran.
export function isMissingShell(stderr: string): boolean {
  return /ENOENT|no such file or directory|not recognized|cannot find the file/i.test(stderr)
}

export * as WindowsShell from "./windows-shell"
