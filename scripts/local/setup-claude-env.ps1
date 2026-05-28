<#
Configures MCP servers for the d365fo-xpp Claude Code plugin.
Writes directly into %USERPROFILE%\.claude.json (mcpServers block).
Idempotent - re-running overwrites previous values. Press Enter to keep the current value.

Usage:
  powershell -ExecutionPolicy Bypass -File scripts\local\setup-claude-env.ps1
#>

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

$configFile = Join-Path $env:USERPROFILE ".claude.json"

# ---------------------------------------------------------------------------
# Load existing config

$existingConfig = $null
if (Test-Path $configFile) {
    $raw = Get-Content $configFile -Raw -Encoding UTF8
    try {
        $existingConfig = $raw | ConvertFrom-Json
    } catch {
        Write-Host "WARNING: could not parse existing $configFile - non-mcpServers keys may be lost." -ForegroundColor Yellow
    }
}

function Get-Nested {
    param($Root, [string[]]$Keys)
    $node = $Root
    foreach ($k in $Keys) {
        if ($null -eq $node) { return $null }
        try   { $node = $node.$k }
        catch { return $null }
    }
    return $node
}

# Pre-fill from existing file
$curApiKey     = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-azure", "headers", "X-Api-Key")
$curArgs       = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-local", "args")
$curServerPath = $null
if ($null -ne $curArgs) {
    $firstArg      = [string]($curArgs | Select-Object -First 1)
    $curServerPath = $firstArg -replace '\\dist\\index\.js$', ''
}
$curPackages   = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-local", "env", "D365FO_PACKAGE_PATH")
$curSolutions  = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-local", "env", "D365FO_SOLUTIONS_PATH")
$curModels     = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-local", "env", "CUSTOM_MODELS")
$curLangs      = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-local", "env", "LABEL_LANGUAGES")

# ---------------------------------------------------------------------------

function Read-Value {
    param([string]$Label, $Current, [string]$Default = "", [switch]$Secret)

    Write-Host "  $Label" -ForegroundColor White
    if ($null -ne $Current -and "$Current" -ne "") {
        $display = if ($Secret) { ("*" * [Math]::Min("$Current".Length, 6)) + "..." } else { "$Current" }
        Write-Host "    current : $display" -ForegroundColor DarkGray
        $raw = Read-Host "    new value (Enter to keep)"
        if ([string]::IsNullOrWhiteSpace($raw)) { return "$Current" }
        return $raw
    }
    if ($Default) { Write-Host "    default : $Default" -ForegroundColor DarkGray }
    $raw = Read-Host "    value"
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    return $raw
}

# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "d365fo-xpp - Claude Code MCP setup" -ForegroundColor Cyan
Write-Host "Writes to: $configFile" -ForegroundColor DarkGray
Write-Host "Re-run to update. Press Enter to keep current value." -ForegroundColor DarkGray
Write-Host ""

$azureApiKey   = Read-Value "Azure MCP API key (X-Api-Key)"         -Current $curApiKey      -Secret
Write-Host ""
$serverPath    = Read-Value "Path to cloned d365fo-mcp-server repo"  -Current $curServerPath  -Default "C:\Repos\d365fo-mcp-server"
$packagesPath  = Read-Value "PackagesLocalDirectory path"             -Current $curPackages    -Default "C:\AosService\PackagesLocalDirectory"
$solutionsPath = Read-Value "D365FO solutions root path"              -Current $curSolutions   -Default "C:\Repos"
$customModels  = Read-Value "Custom models (comma-separated)"         -Current $curModels      -Default ""
$labelLangs    = Read-Value "Label languages"                         -Current $curLangs       -Default "en-US,pl"

# ---------------------------------------------------------------------------
# Build mcpServers object

$mcpServers = [PSCustomObject]@{
    "d365fo-mcp-azure" = [PSCustomObject]@{
        type    = "http"
        url     = "https://intax321-xpp-mcp.azurewebsites.net/mcp/"
        headers = [PSCustomObject]@{ "X-Api-Key" = $azureApiKey }
    }
    "d365fo-mcp-local" = [PSCustomObject]@{
        command = "node"
        args    = @("$serverPath\dist\index.js", "--stdio")
        env     = [PSCustomObject]@{
            MCP_SERVER_MODE       = "write-only"
            D365FO_PACKAGE_PATH   = $packagesPath
            PACKAGES_PATH         = $packagesPath
            D365FO_SOLUTIONS_PATH = $solutionsPath
            CUSTOM_MODELS         = $customModels
            LABEL_LANGUAGES       = $labelLangs
        }
    }
    "ado-remote-mcp" = [PSCustomObject]@{
        type    = "http"
        url     = "https://mcp.dev.azure.com/anegis"
        headers = [PSCustomObject]@{ "X-MCP-Insiders" = "true" }
    }
}

# Merge into existing config (preserve other top-level keys)
if ($null -eq $existingConfig) {
    $existingConfig = [PSCustomObject]@{}
}
if ($existingConfig.PSObject.Properties["mcpServers"]) {
    $existingConfig.PSObject.Properties["mcpServers"].Value = $mcpServers
} else {
    $existingConfig | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value $mcpServers
}

Set-Content -Path $configFile -Value ($existingConfig | ConvertTo-Json -Depth 10) -Encoding UTF8

# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Written to $configFile" -ForegroundColor Green

$warn = $false
foreach ($p in @($serverPath, $packagesPath, $solutionsPath)) {
    if ($p -and -not (Test-Path $p)) {
        if (-not $warn) { Write-Host ""; $warn = $true }
        Write-Host "  WARNING: path does not exist yet: $p" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Restart VS Code, then load the plugin:" -ForegroundColor Cyan
Write-Host "  claude --plugin-dir `"$serverPath\.github`"" -ForegroundColor White
Write-Host ""
