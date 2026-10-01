import { describe, expect, test } from "bun:test"
import { isMissingShell, windowsShellCandidates } from "@/installation/windows-shell"

describe("windows shell resolution chain", () => {
  test("prefers PATH powershell.exe, then System32 absolute, then pwsh", () => {
    expect(windowsShellCandidates({ SystemRoot: "C:\\Windows" })).toEqual([
      "powershell.exe",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "pwsh",
    ])
  })

  test("honors windir, strips trailing separators, and defaults SystemRoot", () => {
    expect(windowsShellCandidates({ windir: "D:\\WinPE\\" })[1]).toBe(
      "D:\\WinPE\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    )
    expect(windowsShellCandidates({})[1]).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    )
  })

  test("deduplicates when SystemRoot is C:\\Windows so PATH and absolute both resolve", () => {
    const candidates = windowsShellCandidates({ SystemRoot: "C:\\Windows" })
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  test("isMissingShell recognizes absent-executable errors but not installer failures", () => {
    expect(isMissingShell("spawn powershell.exe ENOENT")).toBe(true)
    expect(isMissingShell("'pwsh' is not recognized as an internal or external command")).toBe(true)
    expect(isMissingShell("no such file or directory")).toBe(true)
    // A real nonzero exit from a shell that DID run must not be treated as missing.
    expect(isMissingShell("Upgrade failed: the process cannot access the file")).toBe(false)
    expect(isMissingShell("")).toBe(false)
  })
})
