### For Administrators
# Deploy your "D365FnO MCP for X++" support — Hybrid (Azure read-only + local write-only companion)

## Considerations
This instruction deploys the MCP server as a **hybrid**:

- **Azure App Service** hosts the **read-only** MCP — shared search / read tools for the whole team.
- **Local write-only companion** runs on each developer's VM as a stdio MCP — exposes `create_d365fo_file`, `modify_d365fo_file`, `create_label`, `build_d365fo_project`, `run_bp_check`, `trigger_db_sync`, `run_systest_class`, etc.

Copilot in VS Code (and VS 2022, but we're avoiding it) sees **both servers simultaneously**. Read-heavy queries go to Azure; any write/edit of `.xml` / `.xpp` / labels / project files goes through the local companion — the one tool chain that safely touches AOT XML and `.rnrproj`.

Current implementation scope:
1) deploy the cloud MCP as read-only,
2) seed the cloud metadata DB from a D365FO devbox using `scripts/local/build-platform-metadata-local.ps1`,
3) refresh custom metadata from the D365FO source repo with `d365fo-mcp-data-extract-and-build-custom`,
4) configure each developer's local stdio MCP as write-only.

`d365fo-cli` is intentionally out of scope for this first rollout. Treat it as a later evaluation path, not a dependency for the hybrid MCP setup below.

**Why not "just Azure + built-in Copilot edits"?** `.github\copilot-instructions.md` in this repo forbids built-in editors on `.xml` / `.xpp` files. AOT objects must be created through `create_d365fo_file` / `modify_d365fo_file` so XML structure, `.rnrproj` entries, model prefixes, label files, and encoding stay consistent.

D365FnO MCP for X++ will:
1) answer questions about your code (from Azure — shared)
2) create / modify X++ objects (from local companion — per developer)

D365FnO MCP will **not**:
1) answer how a process works in D365FnO.

---------
Repo layout reminder:
```
Azure (read-only)        Local VM (write-only companion)
───────────────────      ───────────────────────────────────────
App Service              node dist/index.js --stdio
  ↑                        ↑
  pipelines push           npm install / npm run build
  app.zip + db             uses your PackagesLocalDirectory directly
```

---

# Part A — One-time Azure setup (read-only server)

## A0. Pre-requisites
- Azure subscription with rights to create Resource Group, App Service, Storage Account, (optional) Azure Managed Redis
- Azure DevOps organisation + project (to run build + data pipelines)
- GitHub account that can read this repository (for the ADO Service Connection to GitHub)
- Azure Storage Explorer *(optional, only if you want the zip-based Azure platform pipeline path)*

## A1. Create Azure resources — ARM template (default path)
Use the ARM template shipped in this repo: [infrastructure/azuredeploy.json](infrastructure/azuredeploy.json). It provisions the full Azure-side stack in one deployment (everything **except** Azure Managed Redis).

### A1.1. Create a Resource Group
Azure Portal → **Resource groups** → **Create** → pick subscription + region → name it (e.g. `rg-xpp-mcp`). The template uses the RG's own `name` as the prefix for every resource it creates, so pick a short, DNS-safe name (lowercase letters, digits, hyphens — max ~20 chars, because the storage account name is derived from it with hyphens stripped).

### A1.2. Deploy the template
Easiest — click:

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Ftfranczyk%2Fd365fo-mcp-server%2Frefs%2Fheads%2Fmain%2Finfrastructure%2Fazuredeploy.json)

or manually: Portal → **Deploy a custom template** → **Build your own template in the editor** → **Load file** → pick `infrastructure/azuredeploy.json` → **Save**.

On the parameters screen:

| Parameter | Default | Recommended |
|---|---|---|
| **Subscription** | — | your subscription |
| **Resource group** | — | the RG from A1.1 |
| **Region** | RG's location | leave as-is (blank `location` = inherit from RG) |
| `appServiceSku` | `B3` | `B3` dev/test, `P0v3`+ for prod |
| `nodeVersion` | `24-lts` | leave |
| `storageSku` | `Standard_LRS` | leave (use `Standard_GRS` if you need geo-redundancy) |
| `labelLanguages` | `en-US,cs,sk,de` | trim to what you actually need (each language = ~125 MB in the labels DB) |
| `apiKey` | *(empty = no auth)* | **set a strong value**, e.g. output of `openssl rand -hex 32` |

Click **Review + create** → **Create**. Takes a minute.

### A1.3. What the template creates
All names are derived from the Resource Group name (= `appName` in the template). For an RG called `rg-xpp-mcp`:

| Resource | Name pattern | Notes |
|---|---|---|
| Storage Account | `rgxppmcp` (hyphens stripped) | StorageV2, SKU from `storageSku` |
| &nbsp;&nbsp;Blob Container | `xpp-metadata` | Built databases land here (`database/xpp-metadata.db` etc.) |
| &nbsp;&nbsp;Blob Container | `packages` | Optional: upload `PackagesLocalDirectory.zip` here if you use the zip-based platform pipeline path |
| App Service Plan | `rg-xpp-mcp-plan` | Linux, tier from `appServiceSku` |
| App Service (Web App) | `rg-xpp-mcp` | Node 24 LTS, HTTPS-only, **system-assigned managed identity enabled**, startup command `bash startup.sh` |

The Web App also comes **pre-populated** with the read-only runtime app settings: `MCP_SERVER_MODE=read-only`, `NODE_ENV=production`, `SCM_DO_BUILD_DURING_DEPLOYMENT=false`, `DB_PATH`, `LABELS_DB_PATH`, `BLOB_CONTAINER_NAME=xpp-metadata`, `BLOB_DATABASE_NAME=database/xpp-metadata.db`, `LABEL_LANGUAGES`, `API_KEY` (if supplied), and an `AZURE_STORAGE_CONNECTION_STRING` already wired to the storage account created in the same deployment.

Result: Part **A2** below becomes a **verification step, not a configuration step** — the values should already be in place. You only need to touch A2 if you want to change defaults (e.g. swap `en-US,cs,sk,de` for your team's language set, enable Redis, or rotate the API key later).

### A1.4. Optional extras (not in the template)
- **Azure Managed Redis** — create separately; then add `REDIS_ENABLED=true`, `REDIS_URL`, `REDIS_CLUSTER_MODE` in the Web App's env vars.
- **Custom domain + certificate** — add via App Service → Custom domains if you don't want the `*.azurewebsites.net` URL.

## A2. App Service — verify environment variables
App Service → Settings → Environment variables:

| Setting | Value |
|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | Storage account → Access keys → Connection string |
| `BLOB_CONTAINER_NAME` | `xpp-metadata` |
| `BLOB_DATABASE_NAME` | `database/xpp-metadata.db` |
| `DB_PATH` | `/tmp/xpp-metadata.db` |
| `LABELS_DB_PATH` | `/tmp/xpp-metadata-labels.db` |
| `LABEL_LANGUAGES` | `en-US,pl` (adjust) |
| `MCP_SERVER_MODE` | `read-only` |
| `NODE_ENV` | `production` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` |
| `WEBSITE_NODE_DEFAULT_VERSION` | `~24` |
| `API_KEY` *(recommended)* | e.g. `openssl rand -hex 32` — required in `X-Api-Key` header |
| `REDIS_ENABLED` *(optional)* | `true` |
| `REDIS_URL` *(optional)* | Azure Managed Redis URL |
| `REDIS_CLUSTER_MODE` *(optional)* | `true` for Enterprise/cluster tier |

**Startup Command** (Settings → Configuration → Stack settings):

```
bash startup.sh
```

> `SCM_DO_BUILD_DURING_DEPLOYMENT=false` is critical — App Service Linux has no gcc/make, so Oryx cannot rebuild `better-sqlite3`. The pipeline ships it pre-compiled for Linux.

---

# Part B — Azure DevOps wiring (for Azure side)

## B1. Service connections (Project Settings → Service connections)
1. **Azure Resource Manager** to your subscription — e.g. `xpp-mcp-azure`. Name goes into `AZURE_SUBSCRIPTION`, so try to keep it aligned with ARG.
2. **GitHub** to the `d365fo-mcp-server` repo — `tfranczyk_d365fo-mcp-server` (or adjust `endpoint:` in the YAMLs).

## B2. Variable Group — `xpp-mcp-server-config`
Pipelines → Library → + Variable group. **Name must be exactly `xpp-mcp-server-config`.**

| Variable | Secret | Example |
|---|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | Yes | (from storage account) |
| `BLOB_CONTAINER_NAME` | No | `xpp-metadata` |
| `CUSTOM_MODELS` | No | `MyPackage` (comma-separated custom models) |
| `AZURE_SUBSCRIPTION` | No | `xpp-mcp-azure` |
| `AZURE_APP_SERVICE_NAME` | No | name of the Web App from A1 |
| `EXTENSION_PREFIX` | No | `Ang` |
| `LABEL_LANGUAGES` | No | `en-US,pl` |

## B3. Optional: upload `PackagesLocalDirectory.zip` (only for the zip-based platform pipeline path)
This is **not required** for the recommended flow in Part C, where you run `scripts/local/build-platform-metadata-local.ps1` from a D365FO devbox with access to `PackagesLocalDirectory`.

Keep this zip-based path only if you intentionally want to run `d365fo-mcp-data-extract-and-build-platform` or `d365fo-mcp-data-platform-upgrade`. Re-upload only after a D365FO version upgrade or major hotfix rollup.

### B3.1. What the zip must contain
The platform pipeline unpacks the archive with:

```bash
unzip -q PackagesLocalDirectory.zip -d $(Pipeline.Workspace)
```

and then expects the path `$(Pipeline.Workspace)/PackagesLocalDirectory/<ModelFolders>...`. That means **the archive must have a single top-level folder named exactly `PackagesLocalDirectory`**, and inside it the raw D365FO package folders (`ApplicationSuite`, `ApplicationFoundation`, `Currency`, `Directory`, …) with their standard AOT subtree (`Ax*`, `bin`, `Descriptor`, etc.). Plain file tree, not flattened, no extra wrapper folder.

Correct layout inside the zip:

```
PackagesLocalDirectory/
├── ApplicationSuite/
│   ├── AxClass/
│   ├── AxTable/
│   └── ...
├── ApplicationFoundation/
├── Currency/
├── Directory/
├── bin/
└── ... (all other standard packages)
```

Wrong (will fail the `ls -la $(Pipeline.Workspace)/PackagesLocalDirectory` sanity step):
- Zip root contains the model folders directly (no `PackagesLocalDirectory/` wrapper).
- Zip root contains one folder with a different name (e.g. `PackagesLocalDirectory-2026-04-22/`).

> Even if you exclude UnitTest/DemoData, the remaining zip typically contains 350+ Microsoft standard models. Platform pipeline only processes these — custom models come later from Git source.

### B3.2. Create and upload the zip
On your D365FO VM:

1. Stop AOS / DynamicsAxBatch services if they are running (avoids "file in use" during compression).

2. Exclude unnecessary packages (UnitTest, DemoData, TestEssentials, Bundle) to reduce zip size and prevent hosted agent disk-space issues during extraction. Zip directly from source (no staging) to avoid copying millions of files:

   ```powershell
   "C:\Program Files\7-Zip\7z.exe" a -tzip -mx=1 C:\Temp\PackagesLocalDirectory.zip `
     K:\AosService\PackagesLocalDirectory `
     -xr!*UnitTest* -xr!*TestEssentials* -xr!*DemoDataSuite* -xr!*DemoDataWellKnownValues* -xr!Bundle
   ```
   
   Parameters explained:
   - `-tzip` = create ZIP (not 7z)
   - `-mx=1` = fastest compression (resulting zip is still several GB; faster upload than heavier compression)
   - `-xr!*UnitTest*` = recursively exclude all folders matching `*UnitTest*` pattern from the staged copy during zipping
   - `-xr!` on large packages = excludes them from the archive (much faster than copying first)
   
   > If you **want** UnitTest models, omit the `-xr!` flags. Just note the zip will be much larger and the hosted agent is more likely to run out of disk during extraction.

3. Upload the result via Azure Storage Explorer:
   - Open storage account → Blob Containers → `packages` → Upload
   - Choose `C:\Temp\PackagesLocalDirectory.zip`
   - The blob name **must stay exactly `PackagesLocalDirectory.zip`** (that's what the pipeline downloads)

### B3.3. Quick self-check before running the pipeline
In Azure Storage Explorer, right-click the blob → Properties. With exclusions: **~4–8 GB**. Without exclusions: **~20–40 GB**. If it's only MBs, something is wrong — either the zip is empty or `PackagesLocalDirectory` was completely excluded.

## B4. Import the pipelines
> Before importing: ensure `.azure-pipelines/` folder exists in your repo root (copy from this repository if needed).

Pipelines → New Pipeline → Azure Repos Git (YAML) → select repo → Configure your pipeline: **Existing Azure Pipelines YAML file**.

For the first hybrid rollout, import these two:

| Pipeline YAML | Purpose | Duration |
|---|---|---|
| `.azure-pipelines/d365fo-mcp-app-deploy.yml` | Builds server code + deploys zip to App Service. Manual run. | ~5-10 min |
| `.azure-pipelines/d365fo-mcp-data-extract-and-build-custom.yml` | Extracts custom models from Git and layers them onto the standard DB. Manual or scheduled run. Requires approval gate. | ~15-30 min |

Keep these optional for later; they are not part of the default path in this document:

| Pipeline YAML | Use only when |
|---|---|
| `.azure-pipelines/d365fo-mcp-data-extract-and-build-platform.yml` | You deliberately want Azure DevOps to process a zipped `PackagesLocalDirectory`. Not expected for this rollout. |
| `.azure-pipelines/d365fo-mcp-data-platform-upgrade.yml` | You deliberately want the all-Azure platform + custom rebuild path after a D365FO version upgrade. |

After import, the approval gates (configured in Part B, Approval environment) will prevent execution until you approve in Azure DevOps.

---

# Part C — First rollout (recommended order)

Run these steps **in this exact order**. Each step depends on the previous one.

## C1. Run `d365fo-mcp-app-deploy`
Deploys server code to App Service. The app boots in read-only mode but its database is empty until C2 finishes. Verify it at least serves `/health`:

```
GET https://<your-app>.azurewebsites.net/health
```

Expected: `{"status":"ok","mode":"read-only", ...}`. Tool count will be tiny (DB empty) — that's fine at this stage.

> Why first? Because C3 auto-restarts the Azure App Service at the end, and C2 can also do so when you pass `-RestartAppService` — there has to be *something* deployed to restart.

## C2. Use an appropriate devbox with access to `PackagesLocalDirectory` to run local script `build-platform-metadata-local.ps1`
Run this on a D365FO development box that can read the full `PackagesLocalDirectory` for the current application version.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/local/build-platform-metadata-local.ps1 `
  -RepoPath "C:\Repos\d365fo-mcp-server" `
  -PackagesPath "K:\AosService\PackagesLocalDirectory" `
  -StorageConnectionString "<AZURE_STORAGE_CONNECTION_STRING>" `
  -BlobContainerName "xpp-metadata" `
  -RestartAppService `
  -AzureSubscription "<subscription-name-or-id>" `
  -AzureResourceGroup "<resource-group>" `
  -AzureAppServiceName "<app-service-name>"
```

The script:
1. Installs dependencies if needed and builds the repo.
2. Runs `npm run extract-metadata` in `standard` mode against your local `PackagesLocalDirectory`.
3. Builds the SQLite databases (`xpp-metadata.db` + `xpp-metadata-labels.db`).
4. Uploads the standard metadata and databases to Azure Blob Storage.
5. Optionally restarts the App Service so it pulls the new DB on cold start.

Duration: 60-120 minutes depending on the VM and metadata volume. It is CPU-heavy, so plan for a long-running local job.

## C3. Run `d365fo-mcp-data-extract-and-build-custom`
Layers your **custom models** (from the Azure DevOps Git repo) on top of the standard DB produced in C2.

This pipeline does **not** use the `packages` container — it reads sources straight from the Git repo (`checkout: self`) and merges into the existing DB by downloading it first from blob storage.

After it finishes (and auto-restarts the App Service), re-hit `/health` — tool count should now match full **read-only** mode (all tools *except* `create_d365fo_file`, `modify_d365fo_file`, `create_label`, build/sync/BP/test, which only exist on the local companion).

## C4. Schedule daily custom metadata refresh
Set a daily schedule for `d365fo-mcp-data-extract-and-build-custom` in Azure DevOps after the first successful manual run.

Recommended default parameters:

| Parameter | Value |
|---|---|
| `extractionMode` | `custom` |
| `customModels` | `all` or your comma-separated model list |
| `skipExtraction` | `false` |

This keeps the cloud read-only MCP close to the latest committed D365FO code while all write operations still happen only on developer machines through the local companion.

## C5. Optional alternative: `d365fo-mcp-data-platform-upgrade`
This is the zip-based Azure equivalent of C2 + C3 fused into one run. Use it only if you intentionally want the all-Azure rebuild path after a D365FO version upgrade or hotfix rollup and you already re-uploaded a fresh `PackagesLocalDirectory.zip`.

---

# Part D — Local write-only companion (per developer VM)

This runs on your D365FO development VM (same box that has Visual Studio 2022 + PackagesLocalDirectory). It serves only the write/build tools over stdio to Copilot.

## D0. Pre-requisites on the VM
- PowerShell as **Administrator**
- `Install-Module -Name d365fo.tools` (allow all)
- `Install-D365SupportingSoftware -Name vscode,python`
  - If Node.js install fails, grab it from https://nodejs.org and use **Repair** if needed.
- Add Node.js to the system `Path` (e.g. `C:\Program Files\nodejs\`) via *Edit the system environment variables*.
- .NET SDK / Visual Studio build tools available to build the C# bridge.
- Reopen terminal as Admin.

## D1. Clone and build the server locally
```powershell
cd C:\Repos
git clone https://github.com/tfranczyk/d365fo-mcp-server.git
cd d365fo-mcp-server
npm install
```

Build the C# bridge. This is mandatory for local write tools such as `create_d365fo_file` and `modify_d365fo_file`.
```powershell
cd bridge\D365MetadataBridge
dotnet build -c Release -p:D365BinPath="J:\AosService\PackagesLocalDirectory\bin"
cd ..\..
```
> Adjust the drive letter to wherever `PackagesLocalDirectory` lives on your VM.

## D2. Configure `.env` (local companion)
```powershell
copy .env.example .env
```
Edit `.env` — at minimum:

| Key | Value |
|---|---|
| `D365FO_PACKAGE_PATH` | `J:\AosService\PackagesLocalDirectory` (or your path) |
| `PACKAGES_PATH` | same value as `D365FO_PACKAGE_PATH` (legacy compatibility) |
| `D365FO_SOLUTIONS_PATH` | root folder that contains your local `.sln` / `.rnrproj` workspaces |
| `CUSTOM_MODELS` | `MyPackage,OtherPackage` |
| `LABEL_LANGUAGES` | `en-US,cs,de` (match Azure) |

You do **not** need to run `npm run extract-metadata` / `build-database` for the local companion. In `write-only` mode it skips the cloud database and serves only local file/build tools. Read queries hit Azure, which already has the DB.

Build TypeScript:
```powershell
npm run build
```

## D3. Smoke-test the stdio server
```powershell
node dist/index.js --stdio
```
It should boot and wait for stdio frames. `Ctrl+C` to stop — you do **not** keep this running manually; VS Code / VS 2022 spawns it per session.

Recommended environment flag to hide read tools (optional, keeps the tool list clean in Copilot):

```powershell
$env:MCP_SERVER_MODE = "write-only"
node dist/index.js --stdio
```

## D4. Place `.github\copilot-instructions.md`
Copy `.github` from the repo to a parent folder shared by all your D365FO solutions (e.g. `C:\Repos\`):

```powershell
Copy-Item -Path ".github" -Destination "C:\Repos\" -Recurse
```

VS 2022 / VS Code walks upward from the `.sln` folder and picks `.github\copilot-instructions.md` for every solution underneath.

---

# Part E — Wire both MCP servers into Copilot

## E1. MCP config — two servers at once
Start from [.mcp.example.json](.mcp.example.json), adjust URL, API key, paths, and model names.

For **VS Code**, use Command Palette → `MCP: Open User Configuration` and edit the generated `mcp.json` (user profile config used by Copilot Chat).

Use this schema for the Azure HTTP server (`type` + `headers`; **do not** use `requestInit.headers`):

```jsonc
{
  "servers": {
    "d365fo-mcp-azure": {
      "type": "http",
      "url": "https://<your app>.azurewebsites.net/mcp/",
      "headers": {
        "X-Api-Key": "<your-X-Api-Key>"
      }
    },
    "d365fo-mcp-local": {
      "command": "node",
      "args": ["C:\\Repos\\d365fo-mcp-server\\dist\\index.js", "--stdio"],
      "env": {
        "MCP_SERVER_MODE": "write-only",
        "D365FO_PACKAGE_PATH": "C:\\AosService\\PackagesLocalDirectory",
        "PACKAGES_PATH": "C:\\AosService\\PackagesLocalDirectory",
        "D365FO_SOLUTIONS_PATH": "C:\\Repos\\D365FO-Intax",
        "CUSTOM_MODELS": "<your list>",
        "LABEL_LANGUAGES": "en-US,pl"
      }
    }
  }
}
```

- Omit `X-Api-Key` if you did not set `API_KEY`.
- Adjust paths. Use **double backslashes** in JSON.
- The local entry uses `command`/`args` (stdio) — VS Code / VS 2022 will spawn it on demand.
- Keep `D365FO_PACKAGE_PATH` and `PACKAGES_PATH` aligned; the former is the primary name, the latter keeps older scripts/tools happy.
- If you keep a separate `%USERPROFILE%\\.mcp.json` for your own automation, sync it into VS Code user `mcp.json` explicitly (VS Code does not guarantee direct pickup of `%USERPROFILE%\\.mcp.json` in all setups).

Copy into place:
```powershell
Copy-Item -Path ".\.mcp.example.json" -Destination "$env:APPDATA\Code\User\mcp.json" -Force
```

Optional one-way sync from `%USERPROFILE%\\.mcp.json` into VS Code user config:
```powershell
if (Test-Path "$env:USERPROFILE\.mcp.json") {
  Copy-Item -Path "$env:USERPROFILE\.mcp.json" -Destination "$env:APPDATA\Code\User\mcp.json" -Force
}
```

## E2. Enable Copilot MCP integration
- **GitHub** → Settings → Copilot → Features → enable **MCP servers in Copilot**.
- **VS 2022** → Tools → Options → GitHub → Copilot → enable *"Enable MCP server integration in agent mode"*. Switch Copilot Chat to **Agent Mode**.
- **VS Code** → Chat → Settings → Agent Customizations → MCP servers → `+` (optional — `.mcp.json` above already covers it; use the UI only if you prefer a non-global scope).

## E3. Restart your editors
Fully restart VS 2022 / VS Code after the first `.mcp.json` change. `CTRL+SHIFT+N` in VS Code for a fresh window, open the repo folder, e.g. `C:\Repos\D365FO-Intax`.

## E4. Test
Open a new chat in **Agent Mode** and ask:

1. `What tables contain a CustAccount field?` — should route to **d365fo-mcp-azure** (read).
2. `Add a field MyNewField (type: CustAccount) to CustTable in model MyPackage.` — should route to **d365fo-mcp-local** (`modify_d365fo_file`).

If Copilot offers to edit `.xml` with a built-in editor instead of calling the local MCP, stop it and remind it to use the local MCP tools — `.github\copilot-instructions.md` should already enforce that.

---

# Part F — Ongoing maintenance

| Event | Azure side | Local companion |
|---|---|---|
| Server code change pushed to `main` | Run `d365fo-mcp-app-deploy` | `git pull` + `npm install` + `npm run build` |
| Your custom models changed | Run or wait for scheduled `d365fo-mcp-data-extract-and-build-custom` + restart App Service | — |
| D365FO version upgrade / hotfix | Run local `scripts/local/build-platform-metadata-local.ps1`, then `d365fo-mcp-data-extract-and-build-custom` | Rebuild the C# bridge against the new `bin` folder |
| New developer joins | Nothing | Follow Part D + E |
| Rotate API key | Update `API_KEY` app setting + restart | Update `X-Api-Key` in every dev's `.mcp.json` |

---

# Part G — Troubleshooting checklist

**Azure (read-only):**
- `/health` 500 on cold start → `AZURE_STORAGE_CONNECTION_STRING` or `BLOB_DATABASE_NAME` wrong.
- `better-sqlite3` crash → zip built on Windows. Re-run `d365fo-mcp-app-deploy`.
- Tool count = 0 → DB downloaded but empty. Re-run a data pipeline.
- 401 on `/mcp/*` → `API_KEY` set but client missing `X-Api-Key`.
- Warning `Error populating auth server metadata...` / `Could not fetch resource metadata...` in VS Code logs usually means the client did not send API auth header; verify Azure entry uses `"type": "http"` and top-level `"headers"`.
- Pipeline "service connection not found" → names in Service Connections must match `AZURE_SUBSCRIPTION` var + `endpoint:` in YAML.
- Variable group not found → must be named exactly `xpp-mcp-server-config`.

**Local write-only companion:**
- Copilot doesn't see local tools → `.mcp.json` path/quotes wrong, or Node not in Path. Check with `node -v` in the same terminal context VS Code runs under.
- `modify_d365fo_file` errors "requires file system access" → you accidentally pointed it at Azure URL. Server name in tool call should match `d365fo-mcp-local`.
- Changes made but not visible to Azure search → expected. Azure DB is rebuilt only by the sync workflows (local platform build and/or Azure pipelines). Run `d365fo-mcp-data-extract-and-build-custom` after significant local changes if the team needs search to catch up.
- Bridge build fails → wrong `D365BinPath`. Point it at the `bin` folder inside `PackagesLocalDirectory`.
