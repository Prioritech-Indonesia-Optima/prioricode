# PrioriCode Installer for Windows (PowerShell)
#
# Usage:
#   irm https://code.prioritech.co.id/install.ps1 | iex
#   irm https://code.prioritech.co.id/install.ps1 | iex -Version 2.0.4
#   .\install.ps1 -NoModifyPath
#
# Environment:
#   PRIORICODE_INSTALL_DIR  Custom installation directory (highest priority)
#
# Default install directory: %USERPROFILE%\.prioricode\bin

[CmdletBinding()]
param(
    [string]$Version,
    [switch]$NoModifyPath
)

$ErrorActionPreference = "Stop"
if (-not $Version -and $env:VERSION) { $Version = $env:VERSION }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$app = "prioricode"
$repo = "Prioritech-Indonesia-Optima/prioricode"

function Write-Muted { param([string]$Message) Write-Host $Message -ForegroundColor DarkGray }
function Write-MutedN { param([string]$Message) Write-Host $Message -ForegroundColor DarkGray -NoNewline }

# --- install directory: $env:PRIORICODE_INSTALL_DIR > %USERPROFILE%\.prioricode\bin ---
if ($env:PRIORICODE_INSTALL_DIR) {
    $installDir = $env:PRIORICODE_INSTALL_DIR
} else {
    $installDir = Join-Path $env:USERPROFILE ".prioricode\bin"
}
try {
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
} catch {
    Write-Host "Error: cannot create installation directory $installDir" -ForegroundColor Red
    Write-Muted "Set PRIORICODE_INSTALL_DIR to a writable directory and retry."
    exit 1
}

# --- clean up binaries parked by earlier in-place upgrades ---
# (see the swap logic below: a running exe is renamed to .old / .old.<guid>,
# and can only be deleted once the process that held it has exited)
Get-ChildItem -Path $installDir -Filter "$app.exe.old*" -Force -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

# --- arch + baseline (AVX2) detection ---
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }

$needsBaseline = $false
if ($arch -eq "x64") {
    try {
        Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);' -Name Kernel32 -Namespace Win32 -PassThru | Out-Null
        if (-not [Win32.Kernel32]::IsProcessorFeaturePresent(40)) {
            $needsBaseline = $true
        }
    } catch {
        $needsBaseline = $true
    }
}

$target = "windows-$arch"
if ($needsBaseline) { $target += "-baseline" }
$filename = "$app-$target.zip"

# --- resolve version + url ---
if ($Version) {
    $specificVersion = $Version -replace '^v', ''
    $tag = "v$specificVersion"
    try {
        Invoke-WebRequest -Method Head -Uri "https://github.com/$repo/releases/tag/$tag" -UseBasicParsing | Out-Null
    } catch {
        Write-Host "Error: Release $tag not found" -ForegroundColor Red
        Write-Muted "Available releases: https://github.com/$repo/releases"
        exit 1
    }
} else {
    try {
        $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -UseBasicParsing
    } catch {
        Write-Host "Failed to fetch version information" -ForegroundColor Red
        exit 1
    }
    $tag = $latest.tag_name
    $specificVersion = $tag -replace '^v', ''
}
$url = "https://github.com/$repo/releases/download/$tag/$filename"

# --- already installed? ---
# Compare against the binary in the *target install directory* (what this run
# would overwrite), not whatever `prioricode` resolves to on PATH — a second
# copy elsewhere must not make an upgrade silently no-op.
$installedBin = Join-Path $installDir "$app.exe"
if (Test-Path $installedBin) {
    try {
        $installed = (& $installedBin --version 2>$null | Select-Object -First 1)
        if ($installed -and "$installed".Trim() -eq $specificVersion) {
            Write-Muted "Version $specificVersion already installed"
            exit 0
        }
        if ($installed) {
            Write-Muted "Installed version: $("$installed".Trim())"
        }
    } catch {}
}

function Get-RemoteFile {
    param([string]$Url, [string]$Out)
    $curlCmd = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curlCmd) {
        & $curlCmd.Source -sSL --fail --retry 10 --retry-delay 2 --retry-all-errors --continue-at - -o $Out $Url
        if ($LASTEXITCODE -ne 0) { throw "download failed with exit code $LASTEXITCODE" }
        return
    }
    for ($i = 1; $i -le 5; $i++) {
        try {
            Invoke-WebRequest -Uri $Url -OutFile $Out -UseBasicParsing
            return
        } catch {
            if ($i -eq 5) { throw }
            Start-Sleep -Seconds 2
        }
    }
}

# Replaces the installed binary even when it is the image of a currently
# running process. Windows locks a running executable against overwrite and
# delete, but the image section is opened with FILE_SHARE_DELETE, so renaming
# the running file IS allowed: park the old copy under a .old name, move the
# new one into place, then best-effort delete the parked copy (it only
# disappears once the old process exits; the sweep at the top of the next run
# catches stragglers). This is what makes `prioricode upgrade` work on
# Windows at all: the installer always runs from inside the old binary.
function Install-Executable {
    param([string]$Source, [string]$Target)
    if (-not (Test-Path $Target)) {
        Move-Item -Path $Source -Destination $Target
        return
    }
    try {
        Move-Item -Force -Path $Source -Destination $Target
        return
    } catch {
        # expected while the target is the running image: fall through
    }
    $leaf = Split-Path -Leaf $Target
    $dir = Split-Path -Parent $Target
    $parkedName = "$leaf.old"
    try {
        Rename-Item -Path $Target -NewName $parkedName -Force
    } catch {
        # A parked copy from an earlier upgrade can sit in Windows'
        # delete-pending state (its name stays reserved until the process that
        # ran it exits), so a second self-upgrade must not collide with it.
        $parkedName = "$leaf.old.$([guid]::NewGuid().ToString('N'))"
        Rename-Item -Path $Target -NewName $parkedName
    }
    $parked = Join-Path $dir $parkedName
    try {
        Move-Item -Path $Source -Destination $Target
    } catch {
        Move-Item -Force -Path $parked -Destination $Target -ErrorAction SilentlyContinue
        throw
    }
    Remove-Item -Force -Path $parked -ErrorAction SilentlyContinue
}

Write-Host ""
Write-MutedN "Installing $app "
Write-MutedN "version: "
Write-Host $specificVersion

# --- download + verify + extract ---
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "prioricode_install_$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
try {
    $archive = Join-Path $tmpDir $filename
    Get-RemoteFile -Url $url -Out $archive

    # Verify against the release's SHA256SUMS.txt when one is published. A
    # missing entry is fatal (tampered/partial release); a missing sums file
    # only happens on pre-checksum releases, so warn and continue.
    $sumsPath = Join-Path $tmpDir "SHA256SUMS.txt"
    $sumsAvailable = $true
    try {
        Get-RemoteFile -Url "https://github.com/$repo/releases/download/$tag/SHA256SUMS.txt" -Out $sumsPath
    } catch {
        $sumsAvailable = $false
    }
    if ($sumsAvailable) {
        $line = Get-Content $sumsPath | Where-Object { (($_ -split "\s+")[-1]) -eq $filename } | Select-Object -First 1
        if (-not $line) {
            Write-Host "Error: SHA256SUMS.txt for $tag does not list $filename — refusing to install it." -ForegroundColor Red
            exit 1
        }
        $expected = ($line -split "\s+")[0]
        $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLower()
        if ($actual -ne $expected.ToLower()) {
            Write-Host "Error: checksum mismatch for $filename (expected $expected, got $actual) — download is corrupt." -ForegroundColor Red
            exit 1
        }
        Write-Muted "Checksum verified for $filename."
    } else {
        Write-Muted "No SHA256SUMS.txt published for $tag; skipping integrity check."
    }

    Expand-Archive -Path $archive -DestinationPath $tmpDir -Force

    $binary = Join-Path $tmpDir "$app.exe"
    if (-not (Test-Path $binary)) {
        Write-Host "Error: archive did not contain $app.exe" -ForegroundColor Red
        exit 1
    }
    $final = Join-Path $installDir "$app.exe"
    try {
        Install-Executable -Source $binary -Target $final
    } catch {
        Write-Host "Error: cannot replace $final : $($_.Exception.Message)" -ForegroundColor Red
        Write-Muted "Close any running PrioriCode terminals, then run this installer again."
        exit 1
    }
} finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}

# --- user PATH ---
if (-not $NoModifyPath) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$installDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$installDir;$userPath", "User")
        Write-Muted "Successfully added $installDir to your user PATH (restart your terminal to take effect)"
    }
}
$env:Path = "$installDir;$env:Path"

# --- banner (ASCII only: Windows PowerShell 5.1 misreads non-ASCII without a BOM) ---
Write-Host ""
Write-Host "  PrioriCode" -ForegroundColor DarkGray -NoNewline
Write-Host "  The open source AI coding agent."
Write-Host ""
Write-Muted "PrioriCode includes free models, to start:"
Write-Host ""
Write-Host "cd <project>  " -NoNewline
Write-Muted "# Open directory"
Write-Host "prioricode    " -NoNewline
Write-Muted "# Run command"
Write-Host ""
Write-Muted "For more information visit "
Write-Host "https://prioritech.co.id"
Write-Host ""
