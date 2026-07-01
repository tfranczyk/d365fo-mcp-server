<#
setup-dev.ps1 - One-command, idempotent local setup + profile switcher for the
D365FnO MCP hybrid. Replaces the manual walk-through of Parts D + E of the
deployment instruction.

WHAT IT DOES (each step is skipped if already done):

  Prerequisites (installs only what is missing; Part D0 of the instruction)
    - d365fo.tools PowerShell module, git, Node.js, .NET SDK

  Part D - local write-only companion build
    - git clone the d365fo-mcp-server repo            (if RepoPath is missing)
    - npm install                                     (if node_modules missing, or -Rebuild)
    - dotnet build of the C# bridge                   (if D365MetadataBridge.exe missing, or -Rebuild)
    - npm run build (TypeScript -> dist\index.js)     (if dist\index.js missing, or -Rebuild)
    - write the tool rules into GLOBAL user memory    (%USERPROFILE%\.claude\CLAUDE.md, managed block)

  Part E - wire MCP servers into %USERPROFILE%\.claude.json (Claude Code only)
    - d365fo-mcp-azure (read), d365fo-mcp-local (write companion), ado-remote-mcp
    - surgically replaces ONLY the mcpServers block, leaving every other byte intact

  Editor integration
    - installs the Claude Code CLI (npm -g) AND the VS Code extension
    - creates a desktop shortcut that opens the code base in VS Code under a
      named VS Code profile:  Code.exe --new-window "<folder>" --profile "<name>"
      (folder = the symlink/custom-packages path if set, else PackagesLocalDirectory)

PROFILES (switching between custom-model code bases)

  Each named profile - typically your VS Code profile name - stores its own
  Azure URL / API key, CUSTOM_MODELS, solutions repo, prefix and languages in:

      %USERPROFILE%\d365fo-mcp.<profile>.json

  RepoPath and PackagesLocalDirectory are shared across profiles (same platform
  bin -> the C# bridge never needs rebuilding when you switch).

  Fresh VM - nothing cloned yet. This script clones the repo itself, so just
  fetch it with PowerShell (no git needed) and run it; it installs git/Node/.NET
  and clones to RepoPath:
      $setup = "$env:TEMP\setup-dev.ps1"
      Invoke-RestMethod "https://raw.githubusercontent.com/tfranczyk/d365fo-mcp-server/main/scripts/local/setup-dev.ps1" -OutFile $setup
      powershell -ExecutionPolicy Bypass -File $setup -Profile ProjectA

  Already cloned - run the in-tree copy (skips the clone), or to edit a profile
  (prompts, pre-filled, then builds + configures):
      powershell -ExecutionPolicy Bypass -File scripts\local\setup-dev.ps1 -Profile ProjectA

  Fast switch later (no prompts, no rebuild - just re-point every MCP server at
  ProjectB's repo / models / cloud DB):
      powershell -ExecutionPolicy Bypass -File scripts\local\setup-dev.ps1 -Profile ProjectB -Switch

  Restart VS Code after a switch.

PARAMETERS
  -Profile <name>     Profile to create/edit/apply. Prompted (with a list of
                      existing profiles) if omitted.
  -Switch             Apply a saved profile with no prompts. Builds are still run
                      only if their output is missing. Fails if the profile does
                      not exist yet (create it once without -Switch first).
  -Rebuild            Force npm install + bridge build + npm run build even if
                      their outputs already exist.
  -RepoPath <path>    Override the repo path for this run (otherwise prompted/saved).
  -ProfileStore <dir> Folder that holds the profile JSON files. Default %USERPROFILE%.
  -SkipPrereqs        Do not check/install d365fo.tools / git / Node / .NET.
                      Also lets the script run without elevation (no installs).
  -NoClone            Do not auto git-clone when RepoPath is missing (just fail).
  -NoInstructionFiles Skip writing the tool rules into %USERPROFILE%\.claude\CLAUDE.md.
  -NoShortcut         Skip creating the VS Code desktop shortcut.
#>

param(
    [string]$Profile = "",
    [switch]$Switch,
    [switch]$Rebuild,
    [string]$RepoPath = "",
    [string]$ProfileStore = "",
    [switch]$SkipPrereqs,
    [switch]$NoClone,
    [switch]$NoInstructionFiles,
    [switch]$NoShortcut
)

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

$RepoUrl     = "https://github.com/tfranczyk/d365fo-mcp-server.git"
$BridgeExe   = "bridge\D365MetadataBridge\bin\Release\D365MetadataBridge.exe"
$configFile  = Join-Path $env:USERPROFILE ".claude.json"

# ===========================================================================
# Small helpers
# ===========================================================================

function Write-Step { param([string]$Msg) Write-Host "==> $Msg" -ForegroundColor Cyan }
function Write-Skip { param([string]$Msg) Write-Host "    skip: $Msg" -ForegroundColor DarkGray }
function Write-Ok   { param([string]$Msg) Write-Host "    ok:   $Msg" -ForegroundColor Green }

function Ensure-Command {
    param([string]$Name, [string]$Hint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is not on PATH.$(if ($Hint) { " $Hint" })"
    }
}

function Invoke-Native {
    # Run a native command and throw on a non-zero exit code (native exes do not
    # honour $ErrorActionPreference). Pass the arguments as ONE explicit array so
    # tokens like '-c' are not mistaken for this function's own parameters.
    param([Parameter(Mandatory)] [string]$Exe, [string[]]$Arguments = @())
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') failed (exit $LASTEXITCODE)." }
}

function Test-IsAdmin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object System.Security.Principal.WindowsPrincipal($id)).IsInRole(
        [System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Update-SessionPath {
    # Re-read Machine + User PATH so a freshly installed tool resolves in THIS
    # session (installers update the registry, not the live $env:Path).
    $parts = @(
        [System.Environment]::GetEnvironmentVariable('Path', 'Machine'),
        [System.Environment]::GetEnvironmentVariable('Path', 'User')
    ) | Where-Object { $_ }
    $env:Path = $parts -join ';'
}

function Ensure-Tool {
    # Install a CLI tool only if its command is missing. Best-effort: try
    # d365fo.tools first (matches the D0 instruction), then winget, then warn.
    param([string]$Command, [string]$D365Name, [string]$WingetId, [string]$Label)
    if (Get-Command $Command -ErrorAction SilentlyContinue) { Write-Skip "$Label present"; return }

    Write-Step "Installing $Label (missing)"
    $ok = $false
    if ($D365Name -and (Get-Command Install-D365SupportingSoftware -ErrorAction SilentlyContinue)) {
        try { Install-D365SupportingSoftware -Name $D365Name -ErrorAction Stop; $ok = $true }
        catch { Write-Host "    d365fo.tools install of '$D365Name' failed: $($_.Exception.Message)" -ForegroundColor DarkYellow }
    }
    if (-not $ok -and $WingetId -and (Get-Command winget -ErrorAction SilentlyContinue)) {
        try {
            winget install --id $WingetId --silent --accept-source-agreements --accept-package-agreements
            $ok = ($LASTEXITCODE -eq 0)
        } catch { Write-Host "    winget install of '$WingetId' failed: $($_.Exception.Message)" -ForegroundColor DarkYellow }
    }
    Update-SessionPath
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        Write-Ok "$Label installed"
    } else {
        Write-Host "    WARNING: could not auto-install $Label. Install it manually, then re-run." -ForegroundColor Yellow
    }
}

function Ensure-Prerequisites {
    # Elevation is guaranteed by the up-front admin check (this only runs when
    # prerequisites may be installed, i.e. not -Switch / -SkipPrereqs).
    Write-Step "Prerequisites - installing only what is missing"

    # d365fo.tools PowerShell module (CurrentUser - no admin needed).
    if (-not (Get-Module -ListAvailable -Name d365fo.tools)) {
        Write-Step "Install-Module d365fo.tools"
        try {
            try { Get-PackageProvider -Name NuGet -ErrorAction Stop | Out-Null }
            catch { Install-PackageProvider -Name NuGet -Force -Scope CurrentUser | Out-Null }
            if ((Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue).InstallationPolicy -ne 'Trusted') {
                Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
            }
            Install-Module -Name d365fo.tools -Scope CurrentUser -Force -AllowClobber
            Write-Ok "d365fo.tools installed"
        } catch {
            Write-Host "    WARNING: d365fo.tools install failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    } else {
        Write-Skip "d365fo.tools present"
    }
    Import-Module d365fo.tools -ErrorAction SilentlyContinue

    # CLI tools the build actually needs.
    Ensure-Tool -Command "git"    -D365Name "git"    -WingetId "Git.Git"               -Label "Git"
    Ensure-Tool -Command "node"   -D365Name "nodejs" -WingetId "OpenJS.NodeJS.LTS"     -Label "Node.js"
    Ensure-Tool -Command "dotnet" -D365Name ""       -WingetId "Microsoft.DotNet.SDK.8" -Label ".NET SDK"
    Write-Host ""
}

function Resolve-CodeExe {
    # Locate VS Code's Code.exe (needed both for --install-extension and for the
    # desktop shortcut target). Checks the usual install locations, then derives
    # it from the 'code' shim on PATH.
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\Code.exe"),
        (Join-Path $env:ProgramFiles "Microsoft VS Code\Code.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft VS Code\Code.exe")
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    $cmd = Get-Command code -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        # ...\Microsoft VS Code\bin\code.cmd  ->  ...\Microsoft VS Code\Code.exe
        $exe = Join-Path (Split-Path (Split-Path $cmd.Source -Parent) -Parent) "Code.exe"
        if (Test-Path $exe) { return $exe }
    }
    return $null
}

function Ensure-ClaudeCode {
    # Claude Code CLI (npm global) + the VS Code extension. Skip-if-present.
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        Write-Skip "Claude Code CLI present"
    } else {
        Write-Step "Installing Claude Code CLI (npm -g @anthropic-ai/claude-code)"
        try { Invoke-Native "npm" @("install", "-g", "@anthropic-ai/claude-code"); Update-SessionPath; Write-Ok "claude CLI installed" }
        catch { Write-Host "    WARNING: claude CLI install failed: $($_.Exception.Message)" -ForegroundColor Yellow }
    }

    if (Get-Command code -ErrorAction SilentlyContinue) {
        $installed = & code --list-extensions 2>$null
        if ($installed -contains "anthropic.claude-code") {
            Write-Skip "Claude Code VS Code extension present"
        } else {
            Write-Step "Installing the Claude Code VS Code extension"
            try { & code --install-extension anthropic.claude-code --force | Out-Null; Write-Ok "Claude Code extension installed" }
            catch { Write-Host "    WARNING: extension install failed: $($_.Exception.Message)" -ForegroundColor Yellow }
        }
    } else {
        Write-Host "    WARNING: 'code' not on PATH - cannot install the VS Code extension." -ForegroundColor Yellow
        Write-Host "             In VS Code run 'Shell Command: Install code command in PATH', then re-run." -ForegroundColor DarkGray
    }
    Write-Host ""
}

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

# ===========================================================================
# Raw-JSON surgical writer for %USERPROFILE%\.claude.json.
#
# We deliberately do NOT round-trip the whole file through ConvertFrom/ConvertTo
# -Json: that reformats the user's entire config, truncates anything deeper than
# -Depth, and outright fails on valid files with case-only duplicate keys (e.g.
# "J:/repo" and "j:/repo" - the same Windows folder, different drive-letter case).
# Instead we locate the top-level "mcpServers" value in the raw text and replace
# just that span. (Same approach as setup-claude-env.ps1.)
# ===========================================================================

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

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Get-JsonValueEnd {
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
    $i = $start
    while ($i -lt $n -and $s[$i] -notmatch '[,}\]\s]') { $i++ }
    return $i
}

function Get-TopLevelValueSpan {
    param([string]$s, [string]$key)
    $n = $s.Length
    $i = 0
    while ($i -lt $n -and $s[$i] -ne '{') { $i++ }
    if ($i -ge $n) { return $null }
    $i++
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
            $i++
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

# ===========================================================================
# 1. Resolve the profile and its store file
# ===========================================================================

Write-Host ""
Write-Host "d365fo-xpp - local dev setup + profile switcher" -ForegroundColor Cyan
Write-Host ""

# Fail fast (before any prompts) if this run will install prerequisites but is
# not elevated. The config-only fast paths (-Switch / -SkipPrereqs) only write to
# the user profile, so they do NOT require admin.
$willInstallPrereqs = -not ($Switch -or $SkipPrereqs)
if ($willInstallPrereqs -and -not (Test-IsAdmin)) {
    throw "Not running as Administrator. This run installs prerequisites (d365fo.tools / git / Node.js / .NET SDK), which needs an elevated PowerShell. Re-run 'as Administrator', or pass -SkipPrereqs if they are already installed."
}

$storeDir = if ($ProfileStore) { $ProfileStore } else { $env:USERPROFILE }
if (-not (Test-Path $storeDir)) { New-Item -ItemType Directory -Force -Path $storeDir | Out-Null }

if (-not $Profile) {
    $existing = @(Get-ChildItem -Path (Join-Path $storeDir "d365fo-mcp.*.json") -ErrorAction SilentlyContinue |
        ForEach-Object { $_.Name -replace '^d365fo-mcp\.', '' -replace '\.json$', '' })
    if ($existing.Count -gt 0) {
        Write-Host "Existing profiles: $($existing -join ', ')" -ForegroundColor DarkGray
    }
    $Profile = Read-Host "Profile name (e.g. your VS Code profile)"
    if ([string]::IsNullOrWhiteSpace($Profile)) { throw "A profile name is required." }
}

$profileFile = Join-Path $storeDir ("d365fo-mcp.$Profile.json")

$saved = $null
if (Test-Path $profileFile) {
    $saved = Get-Content $profileFile -Raw -Encoding UTF8 | ConvertFrom-Json
}

$useSaved = $false
if ($Switch) {
    if ($null -eq $saved) {
        throw "Profile '$Profile' does not exist yet ($profileFile). Run once WITHOUT -Switch to create it."
    }
    $useSaved = $true
    Write-Host "Switching to profile '$Profile' (using saved values, no prompts)." -ForegroundColor Cyan
} else {
    Write-Host "Configuring profile '$Profile'. Press Enter to keep the current/default value." -ForegroundColor DarkGray
}
Write-Host "Profile file: $profileFile" -ForegroundColor DarkGray
Write-Host ""

# ===========================================================================
# 2. Gather values (prompted with pre-fill, or taken verbatim from the profile)
# ===========================================================================

function Ask {
    param([string]$Label, [string]$Field, [string]$Default = "", [switch]$Secret)
    $cur = if ($saved) { $saved.$Field } else { $null }
    if ($useSaved) {
        if ($null -ne $cur -and "$cur" -ne "") { return "$cur" }
        return $Default
    }
    return Read-Value $Label $cur $Default -Secret:$Secret
}

# Shared across profiles (same VM / same platform)
if ($RepoPath) {
    $repoPathVal = $RepoPath
} else {
    $repoPathVal = Ask "Path to the cloned d365fo-mcp-server repo (shared by all profiles)" "RepoPath" "C:\Repos\d365fo-mcp-server"
}
$packagesPath  = Ask "PackagesLocalDirectory path (shared platform)" "PackagesPath" "C:\AosService\PackagesLocalDirectory"

# Per-profile (this is what changes when you switch code bases)
if (-not $useSaved) {
    Write-Host ""
    Write-Host "  --- per-profile (changes when you switch code bases) ---" -ForegroundColor DarkCyan
}
$customModels  = Ask "Custom models (comma-separated)"                 "CustomModels"  ""
$solutionsPath = Ask "Solutions root for this code base (.sln/.rnrproj)" "SolutionsPath" "C:\Repos"
$customPkgPath = Ask "Custom packages path (symlink/junction target, optional)" "CustomPackagesPath" ""
$extPrefix     = Ask "Extension prefix"                                "ExtensionPrefix" "Ang"
$labelLangs    = Ask "Label languages"                                 "LabelLanguages" "en-US,pl"
$azureUrl      = Ask "Azure MCP server URL (read-only, ex. https://blabla.azurewebsites.net/mcp/)"                "AzureUrl" ""
$azureApiKey   = Ask "Azure MCP API key (X-Api-Key, ask TA/DevLead on your project)"                   "AzureApiKey" "" -Secret
$adoOrg        = Ask "Azure DevOps organization name"                  "AdoOrg" "anegis"
$vsCodeProfile = Ask "VS Code profile name (desktop shortcut opens VS Code under it)" "VSCodeProfile" $Profile

# ===========================================================================
# 3. Save the profile (idempotent; re-saving an unchanged switch is a no-op)
# ===========================================================================

$profileObj = [ordered]@{
    RepoPath           = $repoPathVal
    PackagesPath       = $packagesPath
    CustomModels       = $customModels
    SolutionsPath      = $solutionsPath
    CustomPackagesPath = $customPkgPath
    ExtensionPrefix    = $extPrefix
    LabelLanguages     = $labelLangs
    AzureUrl           = $azureUrl
    AzureApiKey        = $azureApiKey
    AdoOrg             = $adoOrg
    VSCodeProfile      = $vsCodeProfile
}
Write-Utf8NoBom -Path $profileFile -Text ($profileObj | ConvertTo-Json)
Write-Host ""
Write-Ok "saved profile -> $profileFile"
Write-Host ""

# ===========================================================================
# 4. Part D - build the local companion (idempotent: only what is missing)
# ===========================================================================

# 4.0 Prerequisites. Skipped on a fast -Switch (assumes an already-built VM) or
#     with -SkipPrereqs. Otherwise installs d365fo.tools / git / Node / .NET if
#     any are missing - a no-op on a configured machine.
if ($Switch -or $SkipPrereqs) {
    Write-Skip "prerequisite check (fast switch / -SkipPrereqs)"
} else {
    Ensure-Prerequisites
}

# 4a. Clone the repo if it is not there yet.
$repoMarker = Join-Path $repoPathVal "package.json"
if (-not (Test-Path $repoMarker)) {
    Write-Step "Repo not found at $repoPathVal"
    if ($NoClone) { throw "RepoPath '$repoPathVal' has no package.json and -NoClone was given." }
    Ensure-Command -Name "git" -Hint "Install Git, or clone the repo manually and pass -RepoPath."
    $parent = Split-Path $repoPathVal -Parent
    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    Invoke-Native "git" @("clone", $RepoUrl, $repoPathVal)
    Write-Ok "cloned $RepoUrl"
} else {
    Write-Skip "repo present at $repoPathVal"
}

Push-Location $repoPathVal
try {
    # 4b. npm install
    if ($Rebuild -or -not (Test-Path (Join-Path $repoPathVal "node_modules"))) {
        Write-Step "npm install"
        Ensure-Command -Name "npm" -Hint "Install Node.js (https://nodejs.org) and add it to PATH."
        Invoke-Native "npm" @("install")
        Write-Ok "dependencies installed"
    } else {
        Write-Skip "node_modules present (use -Rebuild to force npm install)"
    }

    # 4c. Build the C# bridge against this VM's PackagesLocalDirectory\bin
    $bridgeExePath = Join-Path $repoPathVal $BridgeExe
    if ($Rebuild -or -not (Test-Path $bridgeExePath)) {
        $binPath = Join-Path $packagesPath "bin"
        Write-Step "dotnet build (C# bridge) -p:D365BinPath=$binPath"
        Ensure-Command -Name "dotnet" -Hint "Install the .NET SDK / Visual Studio build tools."
        if (-not (Test-Path $binPath)) {
            Write-Host "    WARNING: $binPath not found - the bridge build will likely fail." -ForegroundColor Yellow
        }
        Push-Location (Join-Path $repoPathVal "bridge\D365MetadataBridge")
        try {
            Invoke-Native "dotnet" @("build", "-c", "Release", "-p:D365BinPath=$binPath")
        } finally { Pop-Location }
        Write-Ok "bridge built -> $BridgeExe"
    } else {
        Write-Skip "bridge already built (use -Rebuild to force; rebuild after a D365FO version upgrade)"
    }

    # 4d. Build TypeScript -> dist\index.js
    $distEntry = Join-Path $repoPathVal "dist\index.js"
    if ($Rebuild -or -not (Test-Path $distEntry)) {
        Write-Step "npm run build (TypeScript)"
        Invoke-Native "npm" @("run", "build")
        Write-Ok "dist\index.js built"
    } else {
        Write-Skip "dist\index.js present (use -Rebuild to force)"
    }
} finally {
    Pop-Location
}

# Folder VS Code is opened in (the desktop-shortcut target): the
# symlink/custom-packages path if set, else PackagesLocalDirectory.
$openFolder = if ($customPkgPath) { $customPkgPath } else { $packagesPath }

# 4e. Project instructions -> GLOBAL user memory %USERPROFILE%\.claude\CLAUDE.md.
#     Claude Code loads user memory in EVERY session regardless of which folder is
#     open, so the MCP tool rules apply no matter where the shortcut opens VS Code
#     (which is why this beats trying to drop CLAUDE.md into the opened folder).
#     We replace a managed block in place, preserving any other user content.
if (-not $NoInstructionFiles) {
    $srcInstr = Join-Path $repoPathVal ".github\copilot-instructions.md"
    if (-not (Test-Path $srcInstr)) {
        Write-Skip "instruction source not found (skipping CLAUDE.md)"
    } else {
        $claudeDir = Join-Path $env:USERPROFILE ".claude"
        $userMd    = Join-Path $claudeDir "CLAUDE.md"
        $marker0   = "<!-- BEGIN d365fo-mcp (managed by setup-dev.ps1) -->"
        $marker1   = "<!-- END d365fo-mcp -->"
        Write-Step "CLAUDE.md -> $userMd (global user memory)"
        if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null }
        $rules    = Get-Content $srcInstr -Raw
        $block    = "$marker0`r`n$rules`r`n$marker1"
        $existing = if (Test-Path $userMd) { Get-Content $userMd -Raw } else { "" }
        $pattern  = [regex]::Escape($marker0) + "[\s\S]*?" + [regex]::Escape($marker1)
        $cleaned  = ([regex]::Replace($existing, $pattern, "")).Trim()
        $final    = if ($cleaned) { "$cleaned`r`n`r`n$block`r`n" } else { "$block`r`n" }
        Write-Utf8NoBom -Path $userMd -Text $final
        Write-Ok "CLAUDE.md written to global user memory (managed block)"
    }
}

# 4f. Skills -> personal Claude Code skill store %USERPROFILE%\.claude\skills\<name>.
#     Claude Code auto-discovers personal skills placed here in every session, so
#     this removes the need to run `claude --plugin-dir` by hand. Each skill folder
#     under .github\skills (ang-xpp-dev, ado-anegis, ...) is mirrored fresh so repo
#     edits propagate on the next run.
if (-not $NoInstructionFiles) {
    $srcSkills = Join-Path $repoPathVal ".github\skills"
    if (-not (Test-Path $srcSkills)) {
        Write-Skip "skills source not found (skipping .claude\skills copy)"
    } else {
        $skillsDest = Join-Path $env:USERPROFILE ".claude\skills"
        Write-Step "skills -> $skillsDest"
        if (-not (Test-Path $skillsDest)) { New-Item -ItemType Directory -Force -Path $skillsDest | Out-Null }
        foreach ($skill in Get-ChildItem -Path $srcSkills -Directory) {
            $target = Join-Path $skillsDest $skill.Name
            if (Test-Path $target) { Remove-Item -Recurse -Force $target }
            Copy-Item -Path $skill.FullName -Destination $target -Recurse -Force
            Write-Ok "skill '$($skill.Name)' copied"
        }
    }
}

# ===========================================================================
# 5. Part E - wire the three MCP servers into %USERPROFILE%\.claude.json
# ===========================================================================

Write-Step "Writing MCP servers into $configFile"

$mcpServers = [PSCustomObject]@{
    "d365fo-mcp-azure" = [PSCustomObject]@{
        type    = "http"
        url     = $azureUrl
        headers = [PSCustomObject]@{ "X-Api-Key" = $azureApiKey }
    }
    "d365fo-mcp-local" = [PSCustomObject]@{
        command = "node"
        args    = @("$repoPathVal\dist\index.js", "--stdio")
        env     = [PSCustomObject]@{
            MCP_SERVER_MODE             = "write-only"
            D365FO_PACKAGE_PATH         = $packagesPath
            PACKAGES_PATH               = $packagesPath
            D365FO_CUSTOM_PACKAGES_PATH = $customPkgPath
            D365FO_SOLUTIONS_PATH       = $solutionsPath
            CUSTOM_MODELS               = $customModels
            EXTENSION_PREFIX            = $extPrefix
            LABEL_LANGUAGES             = $labelLangs
        }
    }
    "ado-remote-mcp" = [PSCustomObject]@{
        command = "npx"
        args    = @("-y", "@azure-devops/mcp", $adoOrg)
    }
}

$valueJson = $mcpServers | ConvertTo-Json -Depth 100

if (Test-Path $configFile) {
    $rawConfig = Get-Content $configFile -Raw -Encoding UTF8
    $backup = "$configFile.bak"
    Copy-Item -Path $configFile -Destination $backup -Force
    $updated = Set-RawMcpServers $rawConfig $valueJson
    if (($null -eq $updated) -or ($null -eq (Get-TopLevelValueSpan $updated "mcpServers"))) {
        Write-Host "ERROR: could not locate where to write mcpServers in $configFile." -ForegroundColor Red
        Write-Host "No changes written - your file is untouched (backup at $backup)." -ForegroundColor Red
        exit 1
    }
    Write-Utf8NoBom -Path $configFile -Text $updated
    Write-Host "    (backup of previous file: $backup)" -ForegroundColor DarkGray
} else {
    Write-Utf8NoBom -Path $configFile -Text ("{`n  `"mcpServers`": $valueJson`n}")
}
Write-Ok "MCP servers written for profile '$Profile'"

# ===========================================================================
# 5b. Claude Code editor integration (CLI + VS Code extension)
# ===========================================================================
# Full setup only - on a fast -Switch / -SkipPrereqs these are already in place.
Write-Host ""
if ($Switch -or $SkipPrereqs) {
    Write-Skip "Claude Code CLI / VS Code extension check (fast switch / -SkipPrereqs)"
} else {
    Ensure-ClaudeCode
}

# ===========================================================================
# 5c. Desktop shortcut - opens the code base in VS Code under this profile
# ===========================================================================
# Opens $openFolder (resolved above, same folder that received CLAUDE.md).
if (-not $NoShortcut) {
    $codeExe = Resolve-CodeExe
    if (-not $codeExe) {
        Write-Host "  WARNING: VS Code (Code.exe) not found - skipped desktop shortcut." -ForegroundColor Yellow
    } elseif (-not $vsCodeProfile) {
        Write-Host "  WARNING: no VS Code profile name - skipped desktop shortcut." -ForegroundColor Yellow
    } else {
        Write-Step "Desktop shortcut for VS Code profile '$vsCodeProfile'"
        $desktop = [Environment]::GetFolderPath('Desktop')
        $lnkPath = Join-Path $desktop ("D365FO - $vsCodeProfile.lnk")
        try {
            $ws  = New-Object -ComObject WScript.Shell
            $lnk = $ws.CreateShortcut($lnkPath)
            $lnk.TargetPath       = $codeExe
            $lnk.Arguments        = "--new-window `"$openFolder`" --profile `"$vsCodeProfile`""
            $lnk.WorkingDirectory = Split-Path $codeExe -Parent
            $lnk.IconLocation     = $codeExe
            $lnk.Description       = "Open the D365FO code base for profile $vsCodeProfile in VS Code"
            $lnk.Save()
            Write-Ok "shortcut -> $lnkPath"
            Write-Host "    opens: $openFolder   (--profile $vsCodeProfile)" -ForegroundColor DarkGray
            if (-not (Test-Path $openFolder)) {
                Write-Host "    NOTE: that folder does not exist yet - the shortcut will still open VS Code." -ForegroundColor DarkYellow
            }
        } catch {
            Write-Host "  WARNING: could not create desktop shortcut: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

# ===========================================================================
# 6. Summary
# ===========================================================================

Write-Host ""
Write-Host "Done - profile '$Profile' is active." -ForegroundColor Green

$warn = $false
foreach ($p in @(@{n="RepoPath";v=$repoPathVal}, @{n="PackagesPath";v=$packagesPath}, `
                 @{n="SolutionsPath";v=$solutionsPath}, @{n="CustomPackagesPath";v=$customPkgPath})) {
    if ($p.v -and -not (Test-Path $p.v)) {
        if (-not $warn) { Write-Host ""; $warn = $true }
        Write-Host "  WARNING: $($p.n) does not exist yet: $($p.v)" -ForegroundColor Yellow
    }
}
if (-not $azureUrl)    { Write-Host "  WARNING: Azure MCP URL is empty - the read-only server will not connect." -ForegroundColor Yellow }
if (-not $customModels){ Write-Host "  NOTE: CUSTOM_MODELS is empty for this profile." -ForegroundColor DarkYellow }

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Open the code base via the new desktop shortcut 'D365FO - $vsCodeProfile'" -ForegroundColor White
Write-Host "     (or restart VS Code so Claude Code reloads $configFile)." -ForegroundColor White
Write-Host "  2. Skills (ang-xpp-dev, ado-anegis) were copied to %USERPROFILE%\.claude\skills\ and" -ForegroundColor White
Write-Host "     load automatically - no plugin command needed. Restart Claude Code to pick up changes." -ForegroundColor DarkGray
Write-Host "  3. Verify:  claude mcp list" -ForegroundColor White
Write-Host ""
Write-Host "To switch code bases later:" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\local\setup-dev.ps1 -Profile <name> -Switch" -ForegroundColor White
Write-Host ""
