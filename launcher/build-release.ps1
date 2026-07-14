<#
  Cryo Launcher — build a Velopack release.

  Produces, in .\Releases:
    • Cryo-win-Setup.exe          → the installer you give to users
    • Cryo-<ver>-full.nupkg       → full update package
    • Cryo-<ver>-delta.nupkg      → delta (only changed bytes; created from 2nd release on)
    • releases.win.json / RELEASES→ the update feed Velopack reads

  Usage:
    .\build-release.ps1                 # version from the .csproj <Version>
    .\build-release.ps1 -Version 1.4.1  # override / bump

  After it finishes, publish to GitHub Releases so the app can auto-update:
    vpk upload github --repoUrl https://github.com/xponer/kelvin-launcher `
        --publish --releaseName "Cryo v<ver>" --tag v<ver> --token <YOUR_GH_PAT>
#>
param([string]$Version = "")

$ErrorActionPreference = "Stop"
$proj       = Join-Path $PSScriptRoot "VSpeedLauncher\VSpeedLauncher.csproj"
$publishDir = Join-Path $PSScriptRoot "publish"
$releaseDir = Join-Path $PSScriptRoot "Releases"
$repo       = "https://github.com/xponer/kelvin-launcher"

# ── Resolve version (param wins, else <Version> from the csproj) ──
if (-not $Version) {
    [xml]$csproj = Get-Content $proj
    $Version = ($csproj.Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1)
}
if (-not $Version) { throw "No version. Pass -Version or set <Version> in the csproj." }
Write-Host "==> Building Cryo v$Version" -ForegroundColor Cyan

# ── vpk present? ──
if (-not (Get-Command vpk -ErrorAction SilentlyContinue)) {
    throw "vpk CLI not found. Install it once with:  dotnet tool install -g vpk --version 1.1.1"
}

# ── Stop a running instance so its files aren't locked ──
Get-Process -Name VSpeedLauncher -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# ── Clean publish output ──
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }

# ── Publish self-contained win-x64 ──
Write-Host "==> dotnet publish" -ForegroundColor Cyan
dotnet publish $proj -c Release -r win-x64 --self-contained -o $publishDir "/p:Version=$Version"
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

# ── Pack with Velopack ──
Write-Host "==> vpk pack" -ForegroundColor Cyan
$packArgs = @(
    "pack",
    "--packId",      "Cryo",
    "--packTitle",   "Kelvin",
    "--packAuthors", "xponer",
    "--packVersion", $Version,
    "--packDir",     $publishDir,
    "--mainExe",     "VSpeedLauncher.exe",
    "--outputDir",   $releaseDir
)
$icon = Join-Path $PSScriptRoot "VSpeedLauncher\cryo.ico"
if (Test-Path $icon) { $packArgs += @("--icon", $icon) }
& vpk @packArgs
if ($LASTEXITCODE -ne 0) { throw "vpk pack failed" }

Write-Host ""
Write-Host "==> Done. Artifacts in: $releaseDir" -ForegroundColor Green
Write-Host "    • Cryo-win-Setup.exe  ← give this to users for first install"
Write-Host ""
Write-Host "==> Publish this release to GitHub so installed apps auto-update:" -ForegroundColor Cyan
Write-Host "    vpk upload github --repoUrl $repo --publish --releaseName `"Cryo v$Version`" --tag v$Version --token <YOUR_GH_PAT>"
