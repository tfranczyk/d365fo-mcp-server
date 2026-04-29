<#
.SYNOPSIS
    Repoint an MCP server instance at a new XPP config and rebuild its databases.
.DESCRIPTION
    Use this after upgrading the UDE version for an environment (Microsoft drops
    a new XPPConfig file with a new FrameworkDirectory). Pick the instance, pick
    the new config, and this will update the instance's .env and trigger a rebuild.

    You can pass the instance name directly: .\instances\upgrade-instance.ps1 myinstance
#>
param(
    [string]$InstanceName
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$instancesDir = Join-Path $repoRoot 'instances'

# ── Discover instances ──────────────────────────────────────────────────────
$instances = @(Get-ChildItem -Path $instancesDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName '.env') } |
    Sort-Object Name)

if ($instances.Count -eq 0) {
    Write-Host 'No instances found. Run .\instances\add-instance.ps1 to create one.' -ForegroundColor Yellow
    exit 1
}

# ── Helper: read a value from an .env file ──────────────────────────────────
function Get-EnvValue([string]$envFile, [string]$key) {
    $line = Select-String -Path $envFile -Pattern "^\s*$key\s*=" -List | Select-Object -First 1
    if ($line) { return ($line.Line -replace "^\s*$key\s*=\s*", '').Trim() }
    return $null
}

# ── Select instance ─────────────────────────────────────────────────────────
if ($InstanceName) {
    $selected = $instances | Where-Object { $_.Name -eq $InstanceName }
    if (-not $selected) {
        Write-Host "Instance '$InstanceName' not found." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host ''
    Write-Host 'Available instances:' -ForegroundColor Cyan
    Write-Host ''
    for ($i = 0; $i -lt $instances.Count; $i++) {
        $envFile = Join-Path $instances[$i].FullName '.env'
        $port = Get-EnvValue $envFile 'PORT'
        $cfg = Get-EnvValue $envFile 'XPP_CONFIG_NAME'
        Write-Host "  $($i + 1). $($instances[$i].Name)  " -NoNewline -ForegroundColor White
        Write-Host "(port $port)" -NoNewline -ForegroundColor DarkGray
        if ($cfg) { Write-Host "  [$cfg]" -ForegroundColor DarkGray } else { Write-Host '' }
    }
    Write-Host ''
    $choice = Read-Host 'Select instance [number]'
    $index = [int]$choice - 1
    if ($index -lt 0 -or $index -ge $instances.Count) {
        Write-Host 'Invalid selection.' -ForegroundColor Red
        exit 1
    }
    $selected = $instances[$index]
}

$instanceEnv = Join-Path $selected.FullName '.env'
$currentConfig = Get-EnvValue $instanceEnv 'XPP_CONFIG_NAME'

Write-Host ''
Write-Host "Instance: $($selected.Name)" -ForegroundColor Green
if ($currentConfig) {
    Write-Host "Current XPP_CONFIG_NAME: $currentConfig" -ForegroundColor DarkGray
} else {
    Write-Host 'Current XPP_CONFIG_NAME: (not set)' -ForegroundColor DarkGray
}

# ── List available XPP configs ──────────────────────────────────────────────
$configDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Dynamics365\XPPConfig'
if (-not (Test-Path $configDir)) {
    Write-Host ''
    Write-Host "No XPP config directory found at: $configDir" -ForegroundColor Yellow
    Write-Host 'This directory is created by Power Platform Tools in VS2022.' -ForegroundColor Gray
    exit 1
}

$configs = @(Get-ChildItem -Path $configDir -Filter '*.json' -File |
    Where-Object { $_.Name -match '^(.+)___(.+)\.json$' } |
    Sort-Object LastWriteTime -Descending)

if ($configs.Count -eq 0) {
    Write-Host "No XPP config files found in: $configDir" -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host 'Available XPP Configs' -ForegroundColor Cyan
Write-Host '=====================' -ForegroundColor Cyan
Write-Host ''

for ($i = 0; $i -lt $configs.Count; $i++) {
    $file = $configs[$i]
    $match = [regex]::Match($file.Name, '^(.+)___(.+)\.json$')
    $name = $match.Groups[1].Value
    $version = $match.Groups[2].Value

    $json = Get-Content $file.FullName -Raw | ConvertFrom-Json
    $customPath = $json.ModelStoreFolder
    $msPath = $json.FrameworkDirectory

    $suffix = ''
    if ($i -eq 0) { $suffix += ' (newest)' }
    if ($currentConfig -and ($file.BaseName -eq $currentConfig -or $name -eq $currentConfig)) {
        $suffix += ' (current)'
    }

    Write-Host "  [$($i + 1)] " -NoNewline -ForegroundColor White
    Write-Host "$name" -NoNewline -ForegroundColor Green
    Write-Host "  v$version$suffix" -ForegroundColor Gray
    Write-Host "      Custom:    $customPath" -ForegroundColor DarkGray
    Write-Host "      Microsoft: $msPath" -ForegroundColor DarkGray
    Write-Host ''
}

$selection = Read-Host "Select config (1-$($configs.Count)), or Enter for newest"
if ([string]::IsNullOrWhiteSpace($selection)) {
    $selectedCfg = $configs[0]
} else {
    $idx = [int]$selection - 1
    if ($idx -lt 0 -or $idx -ge $configs.Count) {
        Write-Host 'Invalid selection.' -ForegroundColor Red
        exit 1
    }
    $selectedCfg = $configs[$idx]
}

$newConfigName = $selectedCfg.BaseName  # filename without .json

Write-Host ''
Write-Host 'Change summary:' -ForegroundColor Cyan
if ($currentConfig) {
    Write-Host "  was: $currentConfig" -ForegroundColor DarkYellow
} else {
    Write-Host '  was: (not set)' -ForegroundColor DarkYellow
}
Write-Host "  now: $newConfigName" -ForegroundColor Green

if ($currentConfig -eq $newConfigName) {
    Write-Host ''
    Write-Host 'XPP_CONFIG_NAME is unchanged.' -ForegroundColor Yellow
    $answer = Read-Host 'Rebuild anyway? [y/N]'
    if ($answer -ne 'y') {
        Write-Host 'Aborted.' -ForegroundColor DarkGray
        exit 0
    }
} else {
    Write-Host ''
    $answer = Read-Host 'Write this to the instance .env and rebuild? [Y/n]'
    if ($answer -eq 'n') {
        Write-Host 'Aborted.' -ForegroundColor DarkGray
        exit 0
    }
}

# ── Update the instance .env ────────────────────────────────────────────────
if ($currentConfig -ne $newConfigName) {
    $content = Get-Content $instanceEnv -Raw
    if ($content -match '(?m)^XPP_CONFIG_NAME=.*$') {
        $content = $content -replace '(?m)^XPP_CONFIG_NAME=.*$', "XPP_CONFIG_NAME=$newConfigName"
    } elseif ($content -match '(?m)^#\s*XPP_CONFIG_NAME=') {
        $content = $content -replace '(?m)^#\s*XPP_CONFIG_NAME=.*$', "XPP_CONFIG_NAME=$newConfigName"
    } else {
        $content = $content.TrimEnd() + "`nXPP_CONFIG_NAME=$newConfigName`n"
    }
    Set-Content -Path $instanceEnv -Value $content -NoNewline
    Write-Host ''
    Write-Host "Updated: $instanceEnv" -ForegroundColor Cyan
    Write-Host "  XPP_CONFIG_NAME=$newConfigName" -ForegroundColor DarkGray
}

# ── Hand off to rebuild-instance.ps1 ────────────────────────────────────────
Write-Host ''
Write-Host 'Starting rebuild...' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'rebuild-instance.ps1') $selected.Name
exit $LASTEXITCODE
