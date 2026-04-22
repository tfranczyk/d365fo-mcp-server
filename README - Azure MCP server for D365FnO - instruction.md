### For Administrators
# Deploy your "D365FnO MCP for X++" support — Hybrid (Azure read-only + local write-only companion)

## Considerations
This instruction deploys the MCP server as a **hybrid**:

- **Azure App Service** hosts the **read-only** MCP — shared search / read tools for the whole team.
- **Local write-only companion** runs on each developer's VM as a stdio MCP — exposes `create_d365fo_file`, `modify_d365fo_file`, `create_label`, `build_d365fo_project`, `run_bp_check`, `trigger_db_sync`, `run_systest_class`, etc.

Copilot in VS Code (and VS 2022, but we're avoiding it) sees **both servers simultaneously**. Read-heavy queries go to Azure; any write/edit of `.xml` / `.xpp` / labels / project files goes through the local companion — the one tool chain that safely touches AOT XML and `.rnrproj`.

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
- Azure Storage Explorer (for the one-off `PackagesLocalDirectory.zip` upload)

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
| &nbsp;&nbsp;Blob Container | `packages` | Upload `PackagesLocalDirectory.zip` here (see B4) |
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
| `BLOB_DATABASE_NAME` | `databases/xpp-metadata-latest.db` |
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
2. **GitHub** to the `d365fo-mcp-server` repo — `github.com_tfranczyk` (or adjust `endpoint:` in the YAMLs).

## B2. Variable Group — `xpp-mcp-server-config`
Pipelines → Library → + Variable group. **Name must be exactly `xpp-mcp-server-config`.**

| Variable | Secret | Example |
|---|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | Yes | (from storage account) |
| `BLOB_CONTAINER_NAME` | No | `xpp-metadata` |
| `CUSTOM_MODELS` | No | `MyPackage` (comma-separated custom models) |
| `AZURE_SUBSCRIPTION` | No | `xpp-mcp-azure` |
| `AZURE_APP_SERVICE_NAME` | No | name of the Web App from A1 |

## B3. Import the 4 pipelines
Pipelines → New Pipeline → select repo → **Existing Azure Pipelines YAML file** → pick:

| Pipeline YAML | Purpose | Duration |
|---|---|---|
| `.azure-pipelines/d365fo-mcp-app-deploy.yml` | Builds server code + deploys zip to App Service. Auto-triggers on push to `main`. | ~5 min |
| `.azure-pipelines/d365fo-mcp-data-extract-and-build-custom.yml` | Rebuilds metadata DB for your custom models only. | ~15–30 min |
| `.azure-pipelines/d365fo-mcp-data-extract-and-build-platform.yml` | Rebuilds metadata DB from the uploaded platform zip. | ~60–120 min |
| `.azure-pipelines/d365fo-mcp-data-platform-upgrade.yml` | Full rebuild: standard + custom + labels. | ~90–120 min |

## B4. Upload `PackagesLocalDirectory.zip` (one-off per D365FO version)
On your D365FO VM:

1. Compress `K:\AosService\PackagesLocalDirectory` into a single zip.
2. Upload it to the `packages` container as `PackagesLocalDirectory.zip` via Azure Storage Explorer.

Re-upload only after a D365FO version upgrade or major hotfix rollup.

---

# Part C — First Azure-side run (order of pipelines)

1. `d365fo-mcp-app-deploy` → code to App Service. Check:

   ```
   GET https://<your-app>.azurewebsites.net/health
   ```
   Expected: `{"status":"ok","mode":"read-only", ...}` (tool count will reflect an empty DB until C2/C3 finish).

2. `d365fo-mcp-data-extract-and-build-platform` → builds standard-models DB from the uploaded zip and publishes it to `xpp-metadata`.

3. `d365fo-mcp-data-extract-and-build-custom` → layers your custom models on top.

4. Restart the App Service once (Overview → Restart). On cold start it downloads the new DB into `/tmp`.

5. Re-hit `/health` — tool count should match **read-only** mode (all tools *except* `create_d365fo_file`, `modify_d365fo_file`, `create_label`, build/sync/BP/test).

> Fast path after a D365FO upgrade: `d365fo-mcp-data-platform-upgrade` does C2 + C3 in one run.

---

# Part D — Local write-only companion (per developer VM)

This runs on your D365FO development VM (same box that has Visual Studio 2022 + PackagesLocalDirectory). It serves only the write/build tools over stdio to Copilot.

## D0. Pre-requisites on the VM
- PowerShell as **Administrator**
- `Install-Module -Name d365fo.tools` (allow all)
- `Install-D365SupportingSoftware -Name vscode,python`
  - If Node.js install fails, grab it from https://nodejs.org and use **Repair** if needed.
- Add Node.js to the system `Path` (e.g. `C:\Program Files\nodejs\`) via *Edit the system environment variables*.
- Reopen terminal as Admin.

## D1. Clone and build the server locally
```powershell
cd C:\Repos
git clone https://github.com/dynamics365ninja/d365fo-mcp-server.git
cd d365fo-mcp-server
npm install
```

Build the C# bridge (required for metadata extraction only, but keep it compiled):
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
| `PACKAGES_PATH` | `J:\AosService\PackagesLocalDirectory` (or your path) |
| `CUSTOM_MODELS` | `MyPackage,OtherPackage` |
| `LABEL_LANGUAGES` | `en-US,cs,de` (match Azure) |

You do **not** need to run `npm run extract-metadata` / `build-database` locally — the companion is write-only and does not serve search results. Read queries hit Azure, which already has the DB.

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

## E1. `.mcp.json` — two servers at once
Put this at `%USERPROFILE%\.mcp.json` (both VS 2022 and VS Code pick it up):

```jsonc
{
  "servers": {
    "d365fo-mcp-azure": {
      "url": "https://<your-app>.azurewebsites.net/mcp/",
      "requestInit": {
        "headers": {
          "X-Api-Key": "<value from API_KEY app setting>"
        }
      }
    },
    "d365fo-mcp-local": {
      "command": "node",
      "args": ["C:\\Repos\\d365fo-mcp-server\\dist\\index.js", "--stdio"],
      "env": {
        "MCP_SERVER_MODE": "write-only",
        "PACKAGES_PATH": "J:\\AosService\\PackagesLocalDirectory",
        "CUSTOM_MODELS": "MyPackage"
      }
    }
  }
}
```

- Omit `X-Api-Key` if you did not set `API_KEY`.
- Adjust paths. Use **double backslashes** in JSON.
- The local entry uses `command`/`args` (stdio) — VS Code / VS 2022 will spawn it on demand.

Copy into place:
```powershell
Copy-Item -Path ".\.mcp.json" -Destination "$env:USERPROFILE\.mcp.json" -Force
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
| Server code change pushed to `main` | `d365fo-mcp-app-deploy` auto-runs | `git pull` + `npm install` + `npm run build` |
| Your custom models changed | `d365fo-mcp-data-extract-and-build-custom` + restart App Service | — |
| D365FO version upgrade / hotfix | Re-upload `PackagesLocalDirectory.zip`, run `d365fo-mcp-data-platform-upgrade`, restart App Service | Rebuild the C# bridge against the new `bin` folder |
| New developer joins | Nothing | Follow Part D + E |
| Rotate API key | Update `API_KEY` app setting + restart | Update `X-Api-Key` in every dev's `.mcp.json` |

---

# Part G — Troubleshooting checklist

**Azure (read-only):**
- `/health` 500 on cold start → `AZURE_STORAGE_CONNECTION_STRING` or `BLOB_DATABASE_NAME` wrong.
- `better-sqlite3` crash → zip built on Windows. Re-run `d365fo-mcp-app-deploy`.
- Tool count = 0 → DB downloaded but empty. Re-run a data pipeline.
- 401 on `/mcp/*` → `API_KEY` set but client missing `X-Api-Key`.
- Pipeline "service connection not found" → names in Service Connections must match `AZURE_SUBSCRIPTION` var + `endpoint:` in YAML.
- Variable group not found → must be named exactly `xpp-mcp-server-config`.

**Local write-only companion:**
- Copilot doesn't see local tools → `.mcp.json` path/quotes wrong, or Node not in Path. Check with `node -v` in the same terminal context VS Code runs under.
- `modify_d365fo_file` errors "requires file system access" → you accidentally pointed it at Azure URL. Server name in tool call should match `d365fo-mcp-local`.
- Changes made but not visible to Azure search → expected. Azure DB is rebuilt only by pipelines. Run `d365fo-mcp-data-extract-and-build-custom` after significant local changes if the team needs search to catch up.
- Bridge build fails → wrong `D365BinPath`. Point it at the `bin` folder inside `PackagesLocalDirectory`.

---

> **Intentionally not executed by the assistant.** All Azure, ADO, VM and Copilot configuration steps are for you to perform manually.
