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
$existing = Get-Command $app -ErrorAction SilentlyContinue
if ($existing) {
    try {
        $installed = (& $existing.Source --version 2>$null | Select-Object -First 1)
        if ($installed -and "$installed".Trim() -eq $specificVersion) {
            Write-Muted "Version $specificVersion already installed"
            exit 0
        }
        if ($installed) {
            Write-Muted "Installed version: $("$installed".Trim())"
        }
    } catch {}
}

Write-Host ""
Write-MutedN "Installing $app "
Write-MutedN "version: "
Write-Host $specificVersion

# --- download + extract ---
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "prioricode_install_$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
try {
    $archive = Join-Path $tmpDir $filename
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        & $curl.Source -sSL --fail -o $archive $url
        if ($LASTEXITCODE -ne 0) { throw "download failed with exit code $LASTEXITCODE" }
    } else {
        Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
    }

    Expand-Archive -Path $archive -DestinationPath $tmpDir -Force

    $binary = Join-Path $tmpDir "$app.exe"
    if (-not (Test-Path $binary)) {
        Write-Host "Error: archive did not contain $app.exe" -ForegroundColor Red
        exit 1
    }
    Move-Item -Force -Path $binary -Destination (Join-Path $installDir "$app.exe")
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
