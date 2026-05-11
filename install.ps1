<#
.SYNOPSIS
Copies a `spotizam.js` file to the user's Spicetify Extensions folder and runs `spicetify apply` if Spotify is not running.

.DESCRIPTION
This script assumes spotizam.js is in the same directory as the script, copies it to `%APPDATA%\spicetify\Extensions\spotizam.js`,
and runs `spicetify config extensions spotizam.js` followed by `spicetify apply` when Spotify is closed.

.NOTES
- Requires PowerShell on Windows.
- Requires `spicetify` to be available in PATH to run `spicetify apply`.
- If Spotify is running, the script will ask you to close it and re-run the script.
#>

param(
    [string]$SourcePath
)

# Default to spotizam.js in the same directory as this script
if (-not $SourcePath) {
    $SourcePath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'spotizam.js'
}

if (-not (Test-Path -Path $SourcePath -PathType Leaf)) {
    Write-Host "Source file not found: $SourcePath" -ForegroundColor Red
    exit 2
}

try {
    $SourcePath = Resolve-Path -Path $SourcePath -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Path
} catch {
    Write-Host "Error resolving source path: $_" -ForegroundColor Red
    exit 2
}

$extensionsDir = Join-Path $env:APPDATA 'spicetify\Extensions'
if (-not (Test-Path $extensionsDir)) {
    Write-Host "Creating Extensions folder: $extensionsDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $extensionsDir -Force | Out-Null
}

$destPath = Join-Path $extensionsDir 'spotizam.js'

try {
    Copy-Item -Path $SourcePath -Destination $destPath -Force
    Write-Host "Copied: $SourcePath -> $destPath" -ForegroundColor Green
} catch {
    Write-Host "Failed to copy file: $_" -ForegroundColor Red
    exit 3
}

# Check if Spotify is running
$spotifyProc = Get-Process -Name Spotify -ErrorAction SilentlyContinue
if ($spotifyProc) {
    Write-Host "Spotify appears to be running. Please close the Spotify client and re-run this script to apply the extension." -ForegroundColor Yellow
    exit 0
}

# Ensure spicetify is available
$spicetifyCmd = Get-Command spicetify -ErrorAction SilentlyContinue
if (-not $spicetifyCmd) {
    Write-Host "`n`spicetify` not found in PATH. Please ensure Spicetify is installed and `spicetify` is available in your PATH.`n" -ForegroundColor Red
    Write-Host "You can still run: spicetify config extensions spotizam.js` then `spicetify apply` manually after closing Spotify." -ForegroundColor Yellow
    exit 4
}

Write-Host "Setting Spicetify extensions and applying changes..." -ForegroundColor Cyan

$cfgExit = & spicetify config extensions spotizam.js 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: spicetify config returned exit code $LASTEXITCODE" -ForegroundColor Yellow
    Write-Host $cfgExit
}

$applyOutput = & spicetify apply 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "spicetify apply completed successfully." -ForegroundColor Green
} else {
    Write-Host "spicetify apply failed with exit code $LASTEXITCODE" -ForegroundColor Red
    Write-Host $applyOutput
    exit $LASTEXITCODE
}

Write-Host "Done. You can now start Spotify." -ForegroundColor Green
