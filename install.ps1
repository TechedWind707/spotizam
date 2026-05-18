<#
.SYNOPSIS
Installs the Spotizam extension and optionally the Spotizam custom app for Spicetify.

.DESCRIPTION
This script installs `spotizam.js` into `%APPDATA%\spicetify\Extensions` as the base install.
It then interactively asks whether you also want to install the optional `spotizam` custom app
into `%APPDATA%\spicetify\CustomApps`.

If Spotify is closed, the script registers the selected components with Spicetify and runs
`spicetify apply`.

.NOTES
- Requires PowerShell on Windows.
- Requires `spicetify` to be available in PATH.
- The extension is the base install; the custom app is optional.
#>

param(
    [string]$SourcePath,
    [string]$SourceAppPath
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $SourcePath) {
    $SourcePath = Join-Path $scriptDir 'spotizam.js'
}

if (-not $SourceAppPath) {
    $SourceAppPath = Join-Path $scriptDir 'spotizam'
}

if (-not (Test-Path -Path $SourcePath -PathType Leaf)) {
    Write-Host "Source extension file not found: $SourcePath" -ForegroundColor Red
    exit 2
}

try {
    $SourcePath = (Resolve-Path -Path $SourcePath -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Path)
} catch {
    Write-Host "Error resolving extension source path: $_" -ForegroundColor Red
    exit 2
}

$installCustomApp = $false
if (Test-Path -Path $SourceAppPath -PathType Container) {
    $choice = Read-Host "Do you want to install the optional Spotizam custom app for grouped results/history? [Y/N]"
    if ($choice -match '^(y|yes)$') {
        $installCustomApp = $true
        try {
            $SourceAppPath = (Resolve-Path -Path $SourceAppPath -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Path)
        } catch {
            Write-Host "Error resolving custom app path: $_" -ForegroundColor Red
            exit 2
        }
    }
} else {
    Write-Host "Optional custom app folder not found at: $SourceAppPath" -ForegroundColor Yellow
}

$spicetifyBase = Join-Path $env:APPDATA 'spicetify'
$extensionsDir = Join-Path $spicetifyBase 'Extensions'
$customAppsDir = Join-Path $spicetifyBase 'CustomApps'

if (-not (Test-Path $extensionsDir)) {
    Write-Host "Creating Extensions folder: $extensionsDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $extensionsDir -Force | Out-Null
}

$extensionDestPath = Join-Path $extensionsDir 'spotizam.js'

try {
    Copy-Item -Path $SourcePath -Destination $extensionDestPath -Force
    Write-Host "Copied extension: $SourcePath -> $extensionDestPath" -ForegroundColor Green
} catch {
    Write-Host "Failed to copy extension: $_" -ForegroundColor Red
    exit 3
}

if ($installCustomApp) {
    if (-not (Test-Path $customAppsDir)) {
        Write-Host "Creating CustomApps folder: $customAppsDir" -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $customAppsDir -Force | Out-Null
    }

    $customAppDestPath = Join-Path $customAppsDir 'spotizam'

    try {
        if (Test-Path $customAppDestPath) {
            Remove-Item -Path $customAppDestPath -Recurse -Force
        }
        Copy-Item -Path $SourceAppPath -Destination $customAppDestPath -Recurse -Force
        Write-Host "Copied custom app: $SourceAppPath -> $customAppDestPath" -ForegroundColor Green
    } catch {
        Write-Host "Failed to copy custom app: $_" -ForegroundColor Red
        exit 3
    }
}

$spotifyProc = Get-Process -Name Spotify -ErrorAction SilentlyContinue
if ($spotifyProc) {
    Write-Host "Spotify appears to be running. Please close the Spotify client and re-run this script to apply the install." -ForegroundColor Yellow
    exit 0
}

$spicetifyCmd = Get-Command spicetify -ErrorAction SilentlyContinue
if (-not $spicetifyCmd) {
    Write-Host "`nspicetify not found in PATH." -ForegroundColor Red
    Write-Host "Run these manually after fixing PATH:" -ForegroundColor Yellow
    Write-Host "  spicetify config extensions spotizam.js"
    if ($installCustomApp) {
        Write-Host "  spicetify config custom_apps spotizam"
    }
    Write-Host "  spicetify apply"
    exit 4
}

Write-Host "Registering Spotizam with Spicetify..." -ForegroundColor Cyan

$cfgExtensionsOutput = & spicetify config extensions 2>&1
if ($cfgExtensionsOutput -notmatch '(^|\s)spotizam\.js(\s|$)') {
    $cfgSetExtensionOutput = & spicetify config extensions spotizam.js 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: failed to register extension with Spicetify." -ForegroundColor Yellow
        Write-Host $cfgSetExtensionOutput
    }
}

if ($installCustomApp) {
    $cfgAppsOutput = & spicetify config custom_apps 2>&1
    if ($cfgAppsOutput -notmatch '(^|\s)spotizam(\s|$)') {
        $cfgSetAppOutput = & spicetify config custom_apps spotizam 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Warning: failed to register custom app with Spicetify." -ForegroundColor Yellow
            Write-Host $cfgSetAppOutput
        }
    }
}

Write-Host "Applying Spicetify..." -ForegroundColor Cyan
$applyOutput = & spicetify apply 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "spicetify apply completed successfully." -ForegroundColor Green
    Write-Host "Done. Spotizam extension installed." -ForegroundColor Green
    if ($installCustomApp) {
        Write-Host "Spotizam custom app installed too." -ForegroundColor Green
    } else {
        Write-Host "Custom app skipped. You can install it later." -ForegroundColor Yellow
    }
} else {
    Write-Host "spicetify apply failed with exit code $LASTEXITCODE" -ForegroundColor Red
    Write-Host $applyOutput
    exit $LASTEXITCODE
}
