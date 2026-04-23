<#
Example invocation (basic):
powershell -ExecutionPolicy Bypass -File scripts/local/build-platform-metadata-local.ps1 `
    -RepoPath "C:\Repos\d365fo-mcp-server" `
    -PackagesPath "C:\AosService\PackagesLocalDirectory" `
    -StorageConnectionString "<AZURE_STORAGE_CONNECTION_STRING>" `
    -BlobContainerName "xpp-metadata"

Example invocation (with App Service restart):
powershell -ExecutionPolicy Bypass -File scripts/local/build-platform-metadata-local.ps1 `
    -RepoPath "C:\Repos\d365fo-mcp-server" `
    -PackagesPath "C:\AosService\PackagesLocalDirectory" `
    -StorageConnectionString "<AZURE_STORAGE_CONNECTION_STRING>" `
    -BlobContainerName "xpp-metadata" `
    -RestartAppService `
    -AzureSubscription "<subscription-name-or-id>" `
    -AzureResourceGroup "<resource-group>" `
    -AzureAppServiceName "<app-service-name>"
#>

param(
    [string]$RepoPath = "C:\Repos\d365fo-mcp-server",
    [string]$PackagesPath = "C:\AosService\PackagesLocalDirectory",
    [string]$StorageConnectionString = "",
    [string]$BlobContainerName = "xpp-metadata",
    [string]$WorkRoot = "",
    [switch]$RestartAppService,
    [string]$AzureSubscription = "",
    [string]$AzureResourceGroup = "",
    [string]$AzureAppServiceName = ""
)

$ErrorActionPreference = "Stop"

function Ensure-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is not available in PATH."
    }
}

Ensure-Command -Name "node"
Ensure-Command -Name "npm"

if ($RestartAppService) {
    Ensure-Command -Name "az"
    if ([string]::IsNullOrWhiteSpace($AzureSubscription)) {
        throw "-AzureSubscription is required when -RestartAppService is used."
    }
    if ([string]::IsNullOrWhiteSpace($AzureResourceGroup)) {
        throw "-AzureResourceGroup is required when -RestartAppService is used."
    }
    if ([string]::IsNullOrWhiteSpace($AzureAppServiceName)) {
        throw "-AzureAppServiceName is required when -RestartAppService is used."
    }
}

if (-not (Test-Path -LiteralPath $RepoPath)) {
    throw "RepoPath does not exist: $RepoPath"
}

if (-not (Test-Path -LiteralPath $PackagesPath)) {
    throw "PackagesPath does not exist: $PackagesPath"
}

if ([string]::IsNullOrWhiteSpace($StorageConnectionString)) {
    if ([string]::IsNullOrWhiteSpace($env:AZURE_STORAGE_CONNECTION_STRING)) {
        throw "Storage connection string is missing. Pass -StorageConnectionString or set AZURE_STORAGE_CONNECTION_STRING env var."
    }
} else {
    $env:AZURE_STORAGE_CONNECTION_STRING = $StorageConnectionString
}

$env:BLOB_CONTAINER_NAME = $BlobContainerName
$env:D365FO_PACKAGE_PATH = $PackagesPath
$env:PACKAGES_PATH = $PackagesPath
$env:EXTRACT_MODE = "standard"
$env:INCLUDE_LABELS = "true"

if ([string]::IsNullOrWhiteSpace($WorkRoot)) {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $WorkRoot = Join-Path $RepoPath ".tmp\platform-build-$timestamp"
}

$metadataPath = Join-Path $WorkRoot "extracted-metadata"
$dataPath = Join-Path $WorkRoot "data"
$dbPath = Join-Path $dataPath "xpp-metadata.db"
$labelsDbPath = Join-Path $dataPath "xpp-metadata-labels.db"

New-Item -ItemType Directory -Path $metadataPath -Force | Out-Null
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null

$env:METADATA_PATH = $metadataPath
$env:DB_PATH = $dbPath
$env:LABELS_DB_PATH = $labelsDbPath

Write-Host "=== Local platform metadata build ==="
Write-Host "RepoPath:      $RepoPath"
Write-Host "PackagesPath:  $PackagesPath"
Write-Host "WorkRoot:      $WorkRoot"
Write-Host "Container:     $BlobContainerName"
Write-Host ""

Push-Location $RepoPath
try {
    Write-Host "[1/5] Installing dependencies if needed..."
    npm install

    Write-Host "[2/5] Building TypeScript..."
    npm run build

    Write-Host "[3/5] Extracting standard metadata..."
    npm run extract-metadata

    Write-Host "[4/5] Building SQLite databases..."
    npm run build-database

    Write-Host "[5/5] Uploading metadata and databases to Azure Blob Storage..."
    npm run blob-manager upload-standard
    npm run blob-manager upload-database -- "$dbPath"

    if ($RestartAppService) {
        Write-Host "Restarting Azure App Service..."
        az account set --subscription "$AzureSubscription" | Out-Null
        az webapp restart --name "$AzureAppServiceName" --resource-group "$AzureResourceGroup" | Out-Null
        Write-Host "App Service restarted."
    }

    Write-Host ""
    Write-Host "Done. Standard metadata and databases are uploaded to blob storage."
    Write-Host "Next step: run d365fo-mcp-data-extract-and-build-custom in Azure DevOps."
}
finally {
    Pop-Location
}
