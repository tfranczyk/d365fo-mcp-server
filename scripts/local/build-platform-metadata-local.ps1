<#
Example invocation (basic):
powershell -ExecutionPolicy Bypass -File scripts/local/build-platform-metadata-local.ps1 `
    -RepoPath "C:\Repos\d365fo-mcp-server" `
    -PackagesPath "C:\AosService\PackagesLocalDirectory" `
    -CustomModels "MyModel,OtherModel" `
    -ExtensionPrefix "My" `
    -LabelLanguages "en-US,pl" `
    -StorageConnectionString "<AZURE_STORAGE_CONNECTION_STRING>" `
    -BlobContainerName "xpp-metadata"

Example invocation (with App Service restart):
powershell -ExecutionPolicy Bypass -File scripts/local/build-platform-metadata-local.ps1 `
    -RepoPath "C:\Repos\d365fo-mcp-server" `
    -PackagesPath "C:\AosService\PackagesLocalDirectory" `
    -CustomModels "MyModel,OtherModel" `
    -ExtensionPrefix "My" `
    -LabelLanguages "en-US,pl" `
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
    [string]$CustomModels = "",
    [string]$ExtensionPrefix = "",
    [string]$LabelLanguages = "en-US",
    [string]$StorageConnectionString = "",
    [string]$BlobContainerName = "xpp-metadata",
    [string]$WorkRoot = "",
    [bool]$IncludeLabels = $true,
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
    throw "Storage connection string is missing. Pass -StorageConnectionString explicitly."
}

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

$envFilePath = Join-Path $WorkRoot "platform-build.env"

function Format-EnvValue {
    param([string]$Value)

    if ($null -eq $Value) {
        return ""
    }

    return "'" + ($Value -replace "'", "''") + "'"
}

function Set-ProcessEnvFromMap {
    param([hashtable]$Values)

    $keysToClear = @(
        "AZURE_STORAGE_CONNECTION_STRING",
        "BLOB_CONTAINER_NAME",
        "BLOB_DATABASE_NAME",
        "CUSTOM_MODELS",
        "CUSTOM_MODELS_PATH",
        "DB_PATH",
        "D365FO_CUSTOM_PACKAGES_PATH",
        "D365FO_MICROSOFT_PACKAGES_PATH",
        "D365FO_PACKAGE_PATH",
        "DEV_ENVIRONMENT_TYPE",
        "ENV_FILE",
        "EXTRACT_MODE",
        "EXTENSION_PREFIX",
        "EXTENSION_SUFFIX",
        "INCLUDE_LABELS",
        "LABEL_LANGUAGES",
        "LABELS_DB_PATH",
        "METADATA_PATH",
        "PACKAGES_PATH",
        "SKIP_FTS",
        "VACUUM",
        "XPP_CONFIG_NAME"
    )

    foreach ($key in $keysToClear) {
        Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue
    }

    foreach ($key in $Values.Keys) {
        Set-Item -Path "Env:$key" -Value $Values[$key]
    }
}

$envValues = @{
    "AZURE_STORAGE_CONNECTION_STRING" = $StorageConnectionString
    "BLOB_CONTAINER_NAME"             = $BlobContainerName
    "CUSTOM_MODELS"                   = $CustomModels
    "DB_PATH"                         = $dbPath
    "D365FO_PACKAGE_PATH"             = $PackagesPath
    "DEV_ENVIRONMENT_TYPE"            = "traditional"
    "EXTRACT_MODE"                    = "standard"
    "EXTENSION_PREFIX"                = $ExtensionPrefix
    "INCLUDE_LABELS"                  = $(if ($IncludeLabels) { "true" } else { "false" })
    "LABEL_LANGUAGES"                 = $LabelLanguages
    "LABELS_DB_PATH"                  = $labelsDbPath
    "METADATA_PATH"                   = $metadataPath
    "PACKAGES_PATH"                   = $PackagesPath
}

$envFileLines = foreach ($key in ($envValues.Keys | Sort-Object)) {
    "$key=$(Format-EnvValue -Value $envValues[$key])"
}

$envFileLines | Set-Content -LiteralPath $envFilePath -Encoding UTF8
$envValues["ENV_FILE"] = $envFilePath
Set-ProcessEnvFromMap -Values $envValues

Write-Host "=== Local platform metadata build ==="
Write-Host "RepoPath:      $RepoPath"
Write-Host "PackagesPath:  $PackagesPath"
Write-Host "WorkRoot:      $WorkRoot"
Write-Host "Container:     $BlobContainerName"
Write-Host "CustomModels:  $(if ([string]::IsNullOrWhiteSpace($CustomModels)) { '<none>' } else { $CustomModels })"
Write-Host "Prefix:        $(if ([string]::IsNullOrWhiteSpace($ExtensionPrefix)) { '<none>' } else { $ExtensionPrefix })"
Write-Host "Labels:        $(if ($IncludeLabels) { $LabelLanguages } else { 'disabled' })"
Write-Host "ENV_FILE:      $envFilePath"
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
