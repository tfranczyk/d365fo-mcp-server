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
$rawConfig      = $null
if (Test-Path $configFile) {
    $rawConfig = Get-Content $configFile -Raw -Encoding UTF8
    try {
        $existingConfig = $rawConfig | ConvertFrom-Json
    } catch {
        # PowerShell's ConvertFrom-Json loads into a CASE-INSENSITIVE dictionary,
        # so a perfectly valid .claude.json that has keys differing only by case
        # (e.g. "J:/repo" and "j:/repo" - the same Windows folder seen with a
        # different drive-letter case) throws "duplicated keys". The file is NOT
        # corrupt and Claude Code itself reads it fine. So we must NOT bail here:
        # we keep $rawConfig and update only the mcpServers block surgically below,
        # leaving every other byte untouched. We only lose the ability to pre-fill
        # current values into the prompts.
        Write-Host "Note: $configFile could not be parsed for pre-filling current values." -ForegroundColor Yellow
        Write-Host "      Almost always harmless duplicate case-only keys (e.g. J:/ vs j:/)." -ForegroundColor DarkGray
        Write-Host "      The file is fine - Claude Code reads it. Proceeding with a safe" -ForegroundColor DarkGray
        Write-Host "      in-place update of just the mcpServers block. Re-enter values below." -ForegroundColor DarkGray
        Write-Host ""
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

# ---------------------------------------------------------------------------
# Raw-JSON surgical writer.
#
# We deliberately do NOT round-trip the whole .claude.json through
# ConvertFrom-Json / ConvertTo-Json when writing. That would reformat the
# user's entire file, silently truncate anything nested deeper than -Depth,
# and fail outright on valid files with case-only duplicate keys. Instead we
# locate the top-level "mcpServers" value in the raw text (brace/bracket and
# string aware) and replace just that span, leaving every other byte intact.

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    # PS 5.1 Set-Content -Encoding UTF8 prepends a BOM; Node's JSON.parse dislikes
    # a leading BOM. Write UTF-8 without BOM to stay byte-compatible.
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Get-JsonValueEnd {
    # Index just past the end of the JSON value that starts at $start.
    param([string]$s, [int]$start)
    $n = $s.Length
    $c = $s[$start]
    if ($c -eq '{' -or $c -eq '[') {
        $open  = $c
        $close = if ($c -eq '{') { '}' } else { ']' }
        $depth = 0
        $i = $start
        while ($i -lt $n) {
            $ch = $s[$i]
            if ($ch -eq '"') {
                $i++
                while ($i -lt $n) {
                    if ($s[$i] -eq '\') { $i += 2; continue }
                    if ($s[$i] -eq '"') { break }
                    $i++
                }
                $i++; continue
            }
            if ($ch -eq $open)  { $depth++ }
            elseif ($ch -eq $close) { $depth--; if ($depth -eq 0) { return $i + 1 } }
            $i++
        }
        return $n
    }
    if ($c -eq '"') {
        $i = $start + 1
        while ($i -lt $n) {
            if ($s[$i] -eq '\') { $i += 2; continue }
            if ($s[$i] -eq '"') { return $i + 1 }
            $i++
        }
        return $n
    }
    # primitive: number / true / false / null
    $i = $start
    while ($i -lt $n -and $s[$i] -notmatch '[,}\]\s]') { $i++ }
    return $i
}

function Get-TopLevelValueSpan {
    # Locate a property at the ROOT object's top level (depth 1) whose name
    # matches $key case-SENSITIVELY. Returns {Start;End} of its value, or $null.
    param([string]$s, [string]$key)
    $n = $s.Length
    $i = 0
    while ($i -lt $n -and $s[$i] -ne '{') { $i++ }
    if ($i -ge $n) { return $null }
    $i++          # past root '{', now at depth 1
    $depth = 1
    while ($i -lt $n) {
        $c = $s[$i]
        if ($c -eq '"') {
            $name = ''
            $i++
            while ($i -lt $n) {
                $ch = $s[$i]
                if ($ch -eq '\') { if ($i + 1 -lt $n) { $name += $s[$i + 1] }; $i += 2; continue }
                if ($ch -eq '"') { break }
                $name += $ch; $i++
            }
            $i++      # past closing quote
            if ($depth -eq 1) {
                $j = $i
                while ($j -lt $n -and [char]::IsWhiteSpace($s[$j])) { $j++ }
                if ($j -lt $n -and $s[$j] -eq ':' -and $name -ceq $key) {
                    $j++
                    while ($j -lt $n -and [char]::IsWhiteSpace($s[$j])) { $j++ }
                    $end = Get-JsonValueEnd $s $j
                    return [PSCustomObject]@{ Start = $j; End = $end }
                }
            }
            continue
        }
        if ($c -eq '{' -or $c -eq '[') { $depth++ }
        elseif ($c -eq '}' -or $c -eq ']') { $depth--; if ($depth -eq 0) { break } }
        $i++
    }
    return $null
}

function Set-RawMcpServers {
    # Return $Raw with the top-level "mcpServers" value replaced by $ValueJson
    # (or inserted right after the root '{' if absent). $null if no root object.
    param([string]$Raw, [string]$ValueJson)
    $span = Get-TopLevelValueSpan $Raw "mcpServers"
    if ($null -ne $span) {
        return $Raw.Substring(0, $span.Start) + $ValueJson + $Raw.Substring($span.End)
    }
    $i = 0
    while ($i -lt $Raw.Length -and $Raw[$i] -ne '{') { $i++ }
    if ($i -ge $Raw.Length) { return $null }
    $after = $i + 1
    $j = $after
    while ($j -lt $Raw.Length -and [char]::IsWhiteSpace($Raw[$j])) { $j++ }
    $sep = if ($j -lt $Raw.Length -and $Raw[$j] -eq '}') { "" } else { "," }
    return $Raw.Substring(0, $after) + "`n  `"mcpServers`": " + $ValueJson + $sep + $Raw.Substring($after)
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
$curCustomPkg  = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-local", "env", "D365FO_CUSTOM_PACKAGES_PATH")
$curSolutions  = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-local", "env", "D365FO_SOLUTIONS_PATH")
$curModels     = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-local", "env", "CUSTOM_MODELS")
$curLangs      = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-local", "env", "LABEL_LANGUAGES")
$curUrl        = Get-Nested $existingConfig @("mcpServers", "d365fo-mcp-azure", "url")

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
$azureUrl      = Read-Value "Azure MCP server URL"                  -Current $curUrl
Write-Host ""
$serverPath    = Read-Value "Path to cloned d365fo-mcp-server repo"  -Current $curServerPath  -Default "C:\Repos\d365fo-mcp-server"
$packagesPath  = Read-Value "PackagesLocalDirectory path"             -Current $curPackages    -Default "C:\AosService\PackagesLocalDirectory"
Write-Host "    note    : leave empty unless packages under PackagesLocalDirectory are junctions/symlinks" -ForegroundColor DarkGray
Write-Host "              to a source repo. Set this to that repo's Metadata root so writes through the" -ForegroundColor DarkGray
Write-Host "              link are allowed (the path guard resolves symlinks to their real target)." -ForegroundColor DarkGray
$customPkgPath = Read-Value "Custom packages path (symlink/junction target)" -Current $curCustomPkg -Default ""
$solutionsPath = Read-Value "D365FO solutions root path"              -Current $curSolutions   -Default "C:\Repos"
$customModels  = Read-Value "Custom models (comma-separated)"         -Current $curModels      -Default ""
$labelLangs    = Read-Value "Label languages"                         -Current $curLangs       -Default "en-US,pl"

# ---------------------------------------------------------------------------
# Build mcpServers object

$mcpServers = [PSCustomObject]@{
    "d365fo-mcp-azure" = [PSCustomObject]@{
        type    = "http"
        url     = $azureUrl
        headers = [PSCustomObject]@{ "X-Api-Key" = $azureApiKey }
    }
    "d365fo-mcp-local" = [PSCustomObject]@{
        command = "node"
        args    = @("$serverPath\dist\index.js", "--stdio")
        env     = [PSCustomObject]@{
            MCP_SERVER_MODE             = "write-only"
            D365FO_PACKAGE_PATH         = $packagesPath
            PACKAGES_PATH               = $packagesPath
            D365FO_CUSTOM_PACKAGES_PATH = $customPkgPath
            D365FO_SOLUTIONS_PATH       = $solutionsPath
            CUSTOM_MODELS               = $customModels
            LABEL_LANGUAGES             = $labelLangs
        }
    }
    "ado-remote-mcp" = [PSCustomObject]@{
        type    = "http"
        url     = "https://mcp.dev.azure.com/anegis"
        headers = [PSCustomObject]@{ "X-MCP-Insiders" = "true" }
    }
}

# Write - surgically replace only the mcpServers block, preserving every other
# byte (works even when PowerShell can't parse the file due to case-only keys).

$valueJson = $mcpServers | ConvertTo-Json -Depth 100

if ($null -ne $rawConfig) {
    $backup = "$configFile.bak"
    Copy-Item -Path $configFile -Destination $backup -Force

    $updated = Set-RawMcpServers $rawConfig $valueJson
    if (($null -eq $updated) -or ($null -eq (Get-TopLevelValueSpan $updated "mcpServers"))) {
        Write-Host "ERROR: could not locate where to write mcpServers in $configFile." -ForegroundColor Red
        Write-Host "No changes written - your file is untouched (backup at $backup)." -ForegroundColor Red
        exit 1
    }
    Write-Utf8NoBom -Path $configFile -Text $updated
    Write-Host ""
    Write-Host "Backup of previous file: $backup" -ForegroundColor DarkGray
} else {
    # No existing file - create a minimal one.
    Write-Utf8NoBom -Path $configFile -Text ("{`n  `"mcpServers`": $valueJson`n}")
}

# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Written to $configFile" -ForegroundColor Green

$warn = $false
foreach ($p in @($serverPath, $packagesPath, $customPkgPath, $solutionsPath)) {
    if ($p -and -not (Test-Path $p)) {
        if (-not $warn) { Write-Host ""; $warn = $true }
        Write-Host "  WARNING: path does not exist yet: $p" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Restart VS Code, then load the plugin:" -ForegroundColor Cyan
Write-Host "  claude --plugin-dir `"$serverPath\.github`"" -ForegroundColor White
Write-Host ""
