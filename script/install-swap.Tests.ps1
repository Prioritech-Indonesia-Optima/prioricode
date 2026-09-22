# Functional test for the locked-binary swap in install.ps1 (Windows only).
#
# `prioricode upgrade` on Windows always runs the installer from inside the
# OLD prioricode.exe, so the target binary is a running image the whole time.
# Windows denies overwrite/delete on a running image but allows RENAME (the
# image section is opened with FILE_SHARE_DELETE). install.ps1 handles this by
# parking the old binary as .old and moving the new one into place.
#
# This test extracts the real Install-Executable function from install.ps1
# (kept in sync by the extraction regex, no copy) and runs it against
# file handles that model the exact share flags Windows applies to a running
# executable image.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    Write-Host "SKIP: install-swap tests require Windows"
    exit 0
}

$root = Split-Path -Parent $PSScriptRoot
$installerText = Get-Content -Raw -LiteralPath (Join-Path $root "install.ps1")
$match = [regex]::Match($installerText, "(?ms)^function Install-Executable \{.*?^\}")
if (-not $match.Success) {
    Write-Host "FAIL: could not extract Install-Executable from install.ps1"
    exit 1
}
Invoke-Expression $match.Value

$failures = New-Object System.Collections.Generic.List[string]
function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { $failures.Add($Message) }
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("prioricode-swap-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null

# running image: Read + Delete sharing (overwrite denied, rename allowed)
function Lock-AsRunningImage([string]$Path) {
    $share = [System.IO.FileShare]::Read -bor [System.IO.FileShare]::Delete
    return [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, $share)
}

try {
    # --- case 1: self-upgrade while the target is a running image ---
    $dir1 = Join-Path $tmp "case1"
    New-Item -ItemType Directory -Path $dir1 | Out-Null
    $target1 = Join-Path $dir1 "prioricode.exe"
    $source1 = Join-Path $dir1 "new.exe"
    Set-Content -Path $target1 -Value "old-binary"
    $handle = Lock-AsRunningImage $target1
    try {
        Set-Content -Path $source1 -Value "new-binary"
        Install-Executable -Source $source1 -Target $target1
        Assert-True ((Get-Content -Raw $target1).Trim() -eq "new-binary") "case1: locked target was not replaced with the new binary"
        Assert-True (-not (Test-Path $source1)) "case1: source binary was not consumed"
    } finally {
        $handle.Dispose()
    }

    # --- case 2: plain in-place swap (no other instance running) ---
    $dir2 = Join-Path $tmp "case2"
    New-Item -ItemType Directory -Path $dir2 | Out-Null
    $target2 = Join-Path $dir2 "prioricode.exe"
    $source2 = Join-Path $dir2 "new.exe"
    Set-Content -Path $target2 -Value "old-binary"
    Set-Content -Path $source2 -Value "new-binary"
    Install-Executable -Source $source2 -Target $target2
    Assert-True ((Get-Content -Raw $target2).Trim() -eq "new-binary") "case2: target was not replaced"
    Assert-True (-not (Test-Path (Join-Path $dir2 "prioricode.exe.old"))) "case2: parked copy was not cleaned up"

    # --- case 3: fresh install (target does not exist yet) ---
    $dir3 = Join-Path $tmp "case3"
    New-Item -ItemType Directory -Path $dir3 | Out-Null
    $target3 = Join-Path $dir3 "prioricode.exe"
    $source3 = Join-Path $dir3 "new.exe"
    Set-Content -Path $source3 -Value "new-binary"
    Install-Executable -Source $source3 -Target $target3
    Assert-True ((Get-Content -Raw $target3).Trim() -eq "new-binary") "case3: fresh install did not land at the target path"

    # --- case 4: target unreplaceable (no delete sharing, e.g. stubborn AV
    #     handle): must throw so the caller surfaces a real error instead of
    #     leaving the install half-swapped ---
    $dir4 = Join-Path $tmp "case4"
    New-Item -ItemType Directory -Path $dir4 | Out-Null
    $target4 = Join-Path $dir4 "prioricode.exe"
    $source4 = Join-Path $dir4 "new.exe"
    Set-Content -Path $target4 -Value "old-binary"
    Set-Content -Path $source4 -Value "new-binary"
    $handle4 = [System.IO.File]::Open($target4, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::Read)
    try {
        $threw = $false
        try { Install-Executable -Source $source4 -Target $target4 } catch { $threw = $true }
        Assert-True $threw "case4: expected Install-Executable to throw for an unreplaceable target"
    } finally {
        $handle4.Dispose()
    }

    # --- case 5: second self-upgrade while an earlier parked copy is still
    #     running (its .old name sits in delete-pending state): the swap must
    #     fall back to a unique park name and still complete ---
    $dir5 = Join-Path $tmp "case5"
    New-Item -ItemType Directory -Path $dir5 | Out-Null
    $parked5 = Join-Path $dir5 "prioricode.exe.old"
    Set-Content -Path $parked5 -Value "ancient-binary"
    $parkedHandle = Lock-AsRunningImage $parked5
    try {
        Remove-Item -Force $parked5 -ErrorAction SilentlyContinue
        $target5 = Join-Path $dir5 "prioricode.exe"
        $source5 = Join-Path $dir5 "new.exe"
        Set-Content -Path $target5 -Value "old-binary"
        $targetHandle = Lock-AsRunningImage $target5
        try {
            Set-Content -Path $source5 -Value "new-binary"
            Install-Executable -Source $source5 -Target $target5
            Assert-True ((Get-Content -Raw $target5).Trim() -eq "new-binary") "case5: swap failed while a delete-pending .old name was reserved"
            Assert-True (-not (Test-Path $source5)) "case5: source binary was not consumed"
        } finally {
            $targetHandle.Dispose()
        }
    } finally {
        $parkedHandle.Dispose()
    }
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Host "FAIL: $failure" }
    exit 1
}
Write-Host "PASS: install.ps1 binary swap (5 cases)"
