# Quick Start

Get the D365 F&O MCP Server running with Claude Code in 5 steps.

> **One-command local setup?** Run `scripts\local\setup-dev.ps1` — it installs prerequisites, clones, builds the C# bridge + TypeScript, installs the Claude Code CLI + VS Code extension, wires MCP into `%USERPROFILE%\.claude.json`, and writes the tool rules into `%USERPROFILE%\.claude\CLAUDE.md`. See [README - local MCP server for D365FnO - instruction.md](../README%20-%20local%20MCP%20server%20for%20D365FnO%20-%20instruction.md).
>
> **Server already deployed on Azure by your team?** Skip to [Step 3](#step-3--connect-claude-code) — you only need MCP config.

---

## Step 1 — Prerequisites

| Requirement | Where to get it | Needed for |
|------------|----------------|------------|
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` | all scenarios |
| Node.js 24.x LTS | [nodejs.org](https://nodejs.org) or `Install-D365SupportingSoftware -Name node.js` | local / hybrid |
| Python 3.x | bundled with Node.js installer (check the option) | local / hybrid |
| .NET Framework 4.8 Dev Pack | pre-installed on D365FO VMs | C# bridge (writes) |
| Git | [git-scm.com](https://git-scm.com) | local / hybrid |

---

## Step 2 — Clone and build

```powershell
git clone https://github.com/tfranczyk/d365fo-mcp-server.git K:\d365fo-mcp-server
cd K:\d365fo-mcp-server
npm install
cd bridge\D365MetadataBridge; dotnet build -c Release; cd ..\..   # C# bridge — required for writes
npm run build
```

**Local index** (skip for hybrid — the index lives in Azure):

```powershell
copy .env.example .env           # set PACKAGES_PATH, CUSTOM_MODELS, LABEL_LANGUAGES
npm run extract-metadata
npm run build-database
```

> **UDE / Power Platform Tools?** Run `npm run select-config` instead of setting `PACKAGES_PATH` manually.

---

## Step 3 — Connect Claude Code

Register the server with `claude mcp add-json` (writes to `%USERPROFILE%\.claude.json`). Full Claude Code walkthrough: [CLAUDE_CODE_SETUP.md](CLAUDE_CODE_SETUP.md).

Pick your scenario:

| Scenario | What runs where | Best for |
|----------|----------------|----------|
| [**A** — Azure client](#a--azure-client) | everything on Azure, read-only | team members |
| [**B** — Hybrid](#b--hybrid-azure--local-writes) | Azure search + local writes | **teams (recommended)** |
| [**C** — Local HTTP](#c--local-http) | `npm run dev` on the VM | single developer |
| [**D** — Local stdio](#d--local-stdio) | Claude Code spawns the process | single developer, zero-config |
| **E** — UDE | stdio + XPP config auto-detection | UDE / Power Platform Tools — [SETUP.md](SETUP.md#scenario-d-ude-unified-developer-experience) |
| **F** — Multi-instance | one machine, several clients | agencies — [SETUP.md](SETUP.md#scenario-f-multiple-instances--one-machine-multiple-d365fo-environments) |

### A — Azure client

```powershell
claude mcp add-json --scope user d365fo-mcp-tools '{"type":"http","url":"https://your-server.azurewebsites.net/mcp/","alwaysLoad":true}'
```

> Read-only — cannot write files on your VM. Use **B** for writes.

### B — Hybrid (Azure + local writes)

```powershell
claude mcp add-json --scope user d365fo-azure '{"type":"http","url":"https://your-server.azurewebsites.net/mcp/","alwaysLoad":true}'

claude mcp add-json --scope user d365fo-local '{"type":"stdio","command":"node","args":["K:\\d365fo-mcp-server\\dist\\index.js"],"env":{"MCP_SERVER_MODE":"write-only","D365FO_SOLUTIONS_PATH":"K:\\repos\\MySolution\\projects","D365FO_WORKSPACE_PATH":"K:\\AosService\\PackagesLocalDirectory\\YourPackage\\YourModel"},"alwaysLoad":true}'
```

### C — Local HTTP

```powershell
claude mcp add-json --scope user d365fo-mcp-tools '{"type":"http","url":"http://localhost:8080/mcp/","alwaysLoad":true}'
```

Start with `cd K:\d365fo-mcp-server && npm run dev`.

### D — Local stdio

```powershell
claude mcp add-json --scope user d365fo-mcp-tools '{"type":"stdio","command":"node","args":["K:\\d365fo-mcp-server\\dist\\index.js"],"env":{"MCP_SERVER_MODE":"full","DB_PATH":"K:\\d365fo-mcp-server\\data\\xpp-metadata.db","LABELS_DB_PATH":"K:\\d365fo-mcp-server\\data\\xpp-metadata-labels.db","D365FO_SOLUTIONS_PATH":"K:\\repos\\MySolution\\projects","D365FO_PACKAGE_PATH":"K:\\AosService\\PackagesLocalDirectory"},"alwaysLoad":true}'
```

> Complete parameter reference (every env var, per-scenario matrix): [MCP_CONFIG.md](MCP_CONFIG.md)

---

## Step 4 — Place CLAUDE.md

```powershell
# One copy in a common parent folder covers all solutions beneath it
Copy-Item -Path "K:\d365fo-mcp-server\CLAUDE.template.md" -Destination "C:\source\repos\CLAUDE.md"
```

Claude Code reads `CLAUDE.md` upward from the working directory. **This step is not optional** — it delivers the workflow rules (tool routing, confirm-before-write) that the agent relies on. The same rules are mirrored in the repo's `.github/copilot-instructions.md`, which is the source they are copied from. (`setup-dev.ps1` writes these rules to `%USERPROFILE%\.claude\CLAUDE.md` automatically.)

---

## Step 5 — Verify

| Test | Prompt | Confirms |
|------|--------|----------|
| Search | `What tables contain "CustAccount" field?` | index + connection |
| Write | `Create a class TestHelper with a static method hello()` | C# bridge |
| Forms | `Which form pattern should I use for a setup table with 5 fields?` | pattern advisor |

If the first prompt triggers a `search` tool call with results from your codebase, you are connected.

---

## Logging & Diagnostics

Add to the server's `env` block when something isn't working:

| Variable | Effect |
|----------|--------|
| `DEBUG_LOGGING=true` | Verbose JSON-RPC trace, bridge communication, tool routing |
| `LOG_FILE=C:\Temp\d365fo-mcp.log` | Tee all server output to a file |
| `D365FO_BRIDGE_LOG_FILE=C:\Temp\d365fo-bridge.log` | Full C# bridge diagnostics (DLL loading, write tracing) |

```powershell
Get-Content "C:\Temp\d365fo-mcp.log" -Encoding UTF8 -Wait    # watch live
```

Healthy startup log:

```
✅ C# bridge initialized (metadataAvailable: true, xrefAvailable: true)
```

| Flag | Meaning |
|------|---------|
| `metadataAvailable: false` | D365FO DLLs not loaded — check `packagePath` and .NET 4.8 |
| `xrefAvailable: false` | `DYNAMICSXREFDB` unreachable — non-critical, tools fall back to SQLite |

---

## What's next

| Topic | Documentation |
|-------|--------------|
| All 26 tools | [MCP_TOOLS.md](MCP_TOOLS.md) |
| Real-world tool chains (CoC, forms, security, reports) | [USAGE_EXAMPLES.md](USAGE_EXAMPLES.md) |
| Full configuration reference | [MCP_CONFIG.md](MCP_CONFIG.md) |
| Detailed setup scenarios A–F | [SETUP.md](SETUP.md) |
| Azure deployment (main guide) | [README - Azure MCP server for D365FnO - instruction.md](../README%20-%20Azure%20MCP%20server%20for%20D365FnO%20-%20instruction.md) |
| Local single-VM deployment | [README - local MCP server for D365FnO - instruction.md](../README%20-%20local%20MCP%20server%20for%20D365FnO%20-%20instruction.md) |
| Claude Code CLI | [CLAUDE_CODE_SETUP.md](CLAUDE_CODE_SETUP.md) |
