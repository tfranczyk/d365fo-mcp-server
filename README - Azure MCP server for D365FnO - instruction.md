### For Administrators
# Deploy your "D365FnO MCP for X++" support — Hybrid (Azure read-only + local write-only companion)

## Considerations
This instruction deploys the MCP server as a **hybrid**:

- **Azure App Service** hosts the **read-only** MCP — shared search / read tools for the whole team.
- **Local write-only companion** runs on each developer's VM as a stdio MCP — exposes `d365fo_file` (action=create/modify/generate), `labels` (action=create/rename), `build_d365fo_project`, `run_bp_check`, `trigger_db_sync`, `run_systest_class`, etc.

Claude Code in VS Code sees **both servers simultaneously**. Read-heavy queries go to Azure; any write/edit of `.xml` / `.xpp` / labels / project files goes through the local companion — the one tool chain that safely touches AOT XML and `.rnrproj`.

Current implementation scope:
1) deploy the cloud MCP as read-only,
2) seed the cloud metadata DB from a D365FO devbox using `scripts/local/build-platform-metadata-local.ps1`,
3) refresh custom metadata from the D365FO source repo with `d365fo-mcp-data-extract-and-build-custom`,
4) configure each developer's local stdio MCP as write-only.

`d365fo-cli` is intentionally out of scope for this first rollout. Treat it as a later evaluation path, not a dependency for the hybrid MCP setup below.

**Why not "just Azure + built-in AI edits"?** `CLAUDE.md` (placed in Part D) forbids built-in editors on `.xml` / `.xpp` files. AOT objects must be created through `d365fo_file` (action=create/modify) so XML structure, `.rnrproj` entries, model prefixes, label files, and encoding stay consistent.

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
1. **Azure Resource Manager** to your subscription — e.g. `xpp-mcp-azure`. Name goes into `AZURE_SUBSCRIPTION`, so try to keep it aligned with ARG. Keep the identity type as `App registration (automatic)` if possible; at minimum your entry needs only Azure subs, Resource Group. 
> If anyone else is creating it for you, make sure you're added to its Security config, so it is visible for you.
2. **GitHub** to the `d365fo-mcp-server` repo — `tfranczyk_d365fo-mcp-server` (or adjust `endpoint:` in the YAMLs).

## B2. Variable Group — `xpp-mcp-server-config`
Pipelines → Library → + Variable group. **Name must be exactly `xpp-mcp-server-config`.**

| Variable | Secret | Example |
|---|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | Yes | (from storage account) |
| `BLOB_CONTAINER_NAME` | No | `xpp-metadata` |
| `CUSTOM_MODELS` | No | `MyPackage` (comma-separated custom models) |
| `AZURE_SUBSCRIPTION` | No | `xpp-mcp-azure` (actually the service connection name...) |
| `AZURE_APP_SERVICE_NAME` | No | name of the Web App from A1 |
| `EXTENSION_PREFIX` | No | `Ang` |
| `LABEL_LANGUAGES` | No | `en-US,pl` |

## B3. Import the pipelines
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
Deploys server code to App Service. The app boots in read-only mode but its database is empty until C3 finishes. Verify it at least serves `/health`:

```
GET https://<your-app>.azurewebsites.net/health
```

Expected: `{"status":"ok","mode":"read-only", ...}`. Tool count will be tiny (DB empty) — that's fine at this stage.

> Why first? Because C4 auto-restarts the Azure App Service at the end, and C3 can also do so when you pass `-RestartAppService` — there has to be *something* deployed to restart.

## C2. Optional: upload `PackagesLocalDirectory.zip` (only for the zip-based platform pipeline path)
This is **not required** for the recommended flow, where you run `scripts/local/build-platform-metadata-local.ps1` from a D365FO devbox with access to `PackagesLocalDirectory`.

Keep this zip-based path only if you intentionally want to run pipelines `d365fo-mcp-data-extract-and-build-platform` or `d365fo-mcp-data-platform-upgrade`. Upload or re-upload the package **after C1**, not before the app deploy. In practice, redeploys or resource recreation during the Azure rollout can make an earlier package upload disappear or become stale, so treat C2 as the safe upload point.

Re-upload only after a D365FO version upgrade or major hotfix rollup.

### C2.1. What the zip must contain
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

### C2.2. Create and upload the zip
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

### C2.3. Quick self-check before running the pipeline
In Azure Storage Explorer, right-click the blob → Properties. With exclusions: **~4–8 GB**. Without exclusions: **~20–40 GB**. If it's only MBs, something is wrong — either the zip is empty or `PackagesLocalDirectory` was completely excluded.

## C3. Use an appropriate devbox with access to `PackagesLocalDirectory` to run local script `build-platform-metadata-local.ps1`

### C3.0 brace your devbox
On your VM, in PowerShell (admin mode)
Install-Module -Name d365fo.tools

and allow for all...

Install-D365SupportingSoftware -Name vscode,python
if node.js fails so you need to download and install it manually https://nodejs.org/en

go for REPAIR

after successful installation goto `edit the system environment variables', find your path and edit the one for npm to the target folder of your installation, might be C:\Program Files\nodejs\

reopen your terminal as Admin

### C3.1 Proceed with actual deployment
Run this on a D365FO development box that can read the full `PackagesLocalDirectory` for the current application version.

Do **not** prepare or rely on the repo `.env` file for this step. The script creates its own temporary env file under `.tmp` and points the Node scripts at it via `ENV_FILE`, so `CUSTOM_MODELS`, package paths, label languages, and Azure Blob settings come from the parameters below rather than whatever happens to be in `.env` on the VM.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/local/build-platform-metadata-local.ps1 `
  -RepoPath "C:\Repos\d365fo-mcp-server" `
  -PackagesPath "K:\AosService\PackagesLocalDirectory" `
  -CustomModels "MyPackage,OtherPackage" `
  -ExtensionPrefix "My" `
  -LabelLanguages "en-US,pl" `
  -StorageConnectionString "<AZURE_STORAGE_CONNECTION_STRING>" `
  -BlobContainerName "xpp-metadata" `
  -RestartAppService `
  -AzureSubscription "<subscription-name-or-id>" `
  -AzureResourceGroup "<resource-group>" `
  -AzureAppServiceName "<app-service-name>"
```

Parameter notes:
- `PackagesPath` points at the local platform `PackagesLocalDirectory` to extract.
- `CustomModels` is the comma-separated list of customer/custom models to **exclude** from the standard platform extraction. They are layered in later by C4.
- `ExtensionPrefix` is used as an additional custom-model classifier when model naming follows your prefix convention.
- `LabelLanguages` controls which label translations are indexed in the labels DB.
- `StorageConnectionString` is required explicitly; the script no longer falls back to `AZURE_STORAGE_CONNECTION_STRING` from the shell or `.env`.

The script:
1. Creates an isolated temporary env file from its parameters and prevents the repo `.env` from being loaded.
2. Installs dependencies if needed and builds the repo.
3. Runs `npm run extract-metadata` in `standard` mode against your local `PackagesLocalDirectory`.
4. Builds the SQLite databases (`xpp-metadata.db` + `xpp-metadata-labels.db`).
5. Uploads the standard metadata and databases to Azure Blob Storage.
6. Optionally restarts the App Service so it pulls the new DB on cold start.

Duration: 60-120 minutes depending on the VM and metadata volume. It is CPU-heavy, so plan for a long-running local job.

## C4. Run `d365fo-mcp-data-extract-and-build-custom`
Layers your **custom models** (from the Azure DevOps Git repo) on top of the standard DB produced in C3.

This pipeline does **not** use the `packages` container — it reads sources straight from the Git repo (`checkout: self`) and merges into the existing DB by downloading it first from blob storage.

After it finishes (and auto-restarts the App Service), re-hit `/health` — tool count should now match full **read-only** mode (all tools *except* the write actions of `d365fo_file` / `labels` and build/sync/BP/test, which only exist on the local companion).

## C5. Schedule daily custom metadata refresh
Set a daily schedule for `d365fo-mcp-data-extract-and-build-custom` in Azure DevOps after the first successful manual run.

Recommended default parameters:

| Parameter | Value |
|---|---|
| `extractionMode` | `custom` |
| `customModels` | `all` or your comma-separated model list |
| `skipExtraction` | `false` |

This keeps the cloud read-only MCP close to the latest committed D365FO code while all write operations still happen only on developer machines through the local companion.

## C6. Optional alternative: `d365fo-mcp-data-platform-upgrade`
This is the zip-based Azure equivalent of C3 + C4 fused into one run. Use it only if you intentionally want the all-Azure rebuild path after a D365FO version upgrade or hotfix rollup and you already re-uploaded a fresh `PackagesLocalDirectory.zip` in C2.

---

# Part D — Local developer setup (one script)

This runs on each developer's D365FO VM (the box with Visual Studio 2022 + `PackagesLocalDirectory`). It builds the **write-only companion** — the stdio MCP that serves the local file/build tools to Claude Code — and wires every MCP server into Claude Code. A single idempotent script, `scripts\local\setup-dev.ps1`, does all of it; re-running only does what is still missing.

## D1. Run the setup script

> **⚠ Run PowerShell as Administrator.** The first run installs prerequisites (git / Node.js / .NET SDK), which needs elevation. Right-click PowerShell → **Run as administrator**. The script refuses to start a prerequisite-installing run unelevated (only the `-Switch` / `-SkipPrereqs` config-only paths run without admin).

You do **not** clone anything by hand — the script clones the repo itself. On a fresh VM you only need PowerShell: download the script with `Invoke-RestMethod` (built in, no git required), then run it. It will install git/Node/.NET and clone the repo to `RepoPath` for you. From the **elevated** PowerShell, once per VM, with a profile name (use your VS Code profile name):

```powershell
# Bootstrap: fetch just the script, then let it do everything (incl. the clone)
$setup = "$env:TEMP\setup-dev.ps1"
Invoke-RestMethod "https://raw.githubusercontent.com/tfranczyk/d365fo-mcp-server/main/scripts/local/setup-dev.ps1" -OutFile $setup
powershell -ExecutionPolicy Bypass -File $setup -Profile ProjectA
```

Already have the repo cloned? Run the in-tree copy instead — it skips the clone:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\local\setup-dev.ps1 -Profile ProjectA
```

It prompts once (values are pre-filled on re-run) and then, skipping anything already done:

1. **Installs missing prerequisites** — `d365fo.tools` PowerShell module, git, Node.js, .NET SDK.
2. **Clones** `d365fo-mcp-server` to `RepoPath` (default `C:\Repos\d365fo-mcp-server`).
3. **`npm install`**, then **builds the C# bridge** (`dotnet build -c Release` against your `PackagesLocalDirectory\bin` — mandatory for the `d365fo_file` write tools), then **`npm run build`** (TypeScript → `dist\index.js`).
4. **Writes the MCP tool rules into global user memory** — `%USERPROFILE%\.claude\CLAUDE.md`, which Claude Code loads in **every** session regardless of which folder is open. It replaces a managed block in place, so any other content you keep in that file is preserved. (Global is the right scope here because the MCP config is global too — the rules then apply to every D365FO code base no matter where the shortcut opens VS Code.)
5. **Wires all three MCP servers** (`d365fo-mcp-azure` read, `d365fo-mcp-local` write companion, `ado-remote-mcp`) into `%USERPROFILE%\.claude.json`, surgically replacing only the `mcpServers` block with actual values.
6. **Installs the Claude Code CLI** (`npm -g @anthropic-ai/claude-code`) **and the Claude Code VS Code extension** (`anthropic.claude-code`).
7. **Creates a desktop shortcut** that opens the code base in VS Code under a named VS Code profile — `Code.exe --new-window "<folder>" --profile "<name>"`. The folder is the symlink/custom-packages path if you set one, otherwise `PackagesLocalDirectory`. You choose the profile name when prompted (defaults to the `-Profile` value).

You never run `node dist/index.js` yourself — VS Code spawns the companion per session. You also do **not** need `npm run extract-metadata` / `build-database` locally: in `write-only` mode the companion skips the cloud DB, and read queries hit Azure.

Flags: `-Rebuild` forces npm/bridge/TS rebuild (use after a D365FO version upgrade); `-SkipPrereqs` skips the install check; `-RepoPath` / `-ProfileStore` override locations; `-NoClone` / `-NoInstructionFiles` / `-NoShortcut` opt out of those steps.

## D2. Load the Claude Code plugin (skills) — once per machine

The CLI and VS Code extension are installed by the setup script (D1, steps 6–7). The one remaining manual step is loading the **skills plugin** — the `ang-xpp-dev` skill (X++ coding standards + naming conventions) shipped in `.github\` of the repo:

```powershell
claude --plugin-dir "C:\Repos\d365fo-mcp-server\.github"
```

It applies to all Claude Code sessions on the machine and is invokable as `/d365fo-xpp:ang-xpp-dev`. After pulling repo updates, run `/reload-plugins` in an active session.

## D3. Switch code bases (profiles)

Each profile stores its own Azure URL/API key, `CUSTOM_MODELS`, solutions repo, prefix and languages in `%USERPROFILE%\d365fo-mcp.<profile>.json`. `RepoPath` and `PackagesLocalDirectory` are shared across profiles (same platform `bin`, so the C# bridge is never rebuilt on a switch). To re-point every MCP server at another custom-model code base — no prompts, no rebuild:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\local\setup-dev.ps1 -Profile ProjectB -Switch
```

Restart VS Code after a switch. The same `-Switch` form is the fast way to rotate the API key or change models on an already-built VM. (The lower-level `scripts\local\setup-claude-env.ps1` still exists for a profile-less, config-only prompt.)

## D4. Verify

1. Open the code base via the new **desktop shortcut** (`D365FO - <profile>`) — it launches VS Code under the right profile and folder — or restart VS Code (`Ctrl+Shift+N` for a fresh window) and open your D365FO repo. Approve the **trust** prompt for all three servers on first use. The config is global (`%USERPROFILE%\.claude.json`), so it applies regardless of which folder is open.
2. Confirm the servers are registered:
   ```powershell
   claude mcp list
   ```
3. *(Optional)* Smoke-test the companion directly — it should boot and wait for stdio frames; `Ctrl+C` to stop:
   ```powershell
   node dist/index.js --stdio
   ```
4. In a new chat:
   - `What tables contain a CustAccount field?` → routes to **d365fo-mcp-azure** (read).
   - `Add a field MyNewField (type: CustAccount) to CustTable in model MyPackage.` → routes to **d365fo-mcp-local** (`d365fo_file` action=modify).

If the AI uses built-in file edits instead of the local MCP, the rules are out of scope: verify `%USERPROFILE%\.claude\CLAUDE.md` exists and contains the `d365fo-mcp` managed block (re-run `setup-dev.ps1` to rewrite it).

---

# Part F — Ongoing maintenance

| Event | Azure side | Local companion |
|---|---|---|
| Server code change pushed to `main` | Run `d365fo-mcp-app-deploy` | `git pull`, then `setup-dev.ps1 -Profile <name> -Rebuild`; reload the plugin (D2) if it changed |
| Your custom models changed | Run or wait for scheduled `d365fo-mcp-data-extract-and-build-custom` + restart App Service | — |
| D365FO version upgrade / hotfix | Run local `scripts/local/build-platform-metadata-local.ps1`, then `d365fo-mcp-data-extract-and-build-custom` | `setup-dev.ps1 -Profile <name> -Rebuild` (rebuilds the C# bridge against the new `bin`) |
| New developer joins | Nothing | Follow Part D (run `setup-dev.ps1`) |
| Rotate API key | Update `API_KEY` app setting + restart | Re-run `setup-dev.ps1 -Profile <name> -Switch` with the new key (updates `X-Api-Key` in `%USERPROFILE%\.claude.json`) |

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
- Claude Code doesn't see local tools → plugin not loaded (`claude --plugin-dir` not run), the MCP entry missing/misconfigured (re-run `setup-dev.ps1`), or Node not in Path. Check with `node -v` in a VS Code-launched terminal. Run `claude mcp list` to verify the servers are registered.
- `d365fo_file` (action=modify) errors "requires file system access" → you accidentally pointed it at Azure URL. Server name in tool call should match `d365fo-mcp-local`.
- Changes made but not visible to Azure search → expected. Azure DB is rebuilt only by the sync workflows (local platform build and/or Azure pipelines). Run `d365fo-mcp-data-extract-and-build-custom` after significant local changes if the team needs search to catch up.
- Bridge build fails → wrong `D365BinPath`. Point it at the `bin` folder inside `PackagesLocalDirectory`.
