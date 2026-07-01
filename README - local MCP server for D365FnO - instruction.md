### For Administrators 
# Deploy your "D365FnO MCP for X++" support

## Considerations
This instruction is intended to help you build and deploy your MCP server. MCP server will be one of a helpful instances to support your work as D365FnO developer or consultant.
D365FnO MCP for X++ will:
1) answer the questions about your code

D365FnO MCP will **not**:
1) answer a question how does the process work in D365FnO.

# Instruction

## Part A — Build and run the server (all clients)

1. On your VM, in PowerShell (admin mode):

   `Install-Module -Name d365fo.tools`

   and allow for all...

2. `Install-D365SupportingSoftware -Name vscode,python`

   > If node.js fails, download and install it manually from https://nodejs.org/en and choose **Repair**.

3. After successful installation go to *Edit the system environment variables*, find your `Path` and point the npm entry at your install folder, e.g. `C:\Program Files\nodejs\`.

4. Reopen your terminal as Admin.

5. Navigate to the repo path and run `npm install`.

   > Check `\bridge\D365MetadataBridge\Program.cs` against the `_packagesPath`.

6. Navigate to `bridge\D365MetadataBridge` and run:

   `dotnet build -c Release -p:D365BinPath="J:\AosService\PackagesLocalDirectory\bin"`

7. Copy `.env.example`:

   ```
   cd ..\..
   copy .env.example .env
   ```

8. Amend `.env` and set `PACKAGES_PATH`, `CUSTOM_MODELS`, `LABEL_LANGUAGES`.

9. Run `npm run extract-metadata` and wait (~15 min).

10. Run `npm run build-database` and wait (less than above).

11. Run `npm run build` (a second).

12. Open a dedicated new terminal and load the machine + user `Path`:

    `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`

13. Run `npm run dev` in that dedicated window (preferably PowerShell). **Keep it open** — it serves the MCP over HTTP at `http://localhost:8080/mcp/`.

Now wire the running server into **Claude Code → Part B** below. Keep the dedicated `npm run dev` window open the whole time.

# Part B — Wire into Claude Code (local MCP)

Do **Part A** first and keep the `npm run dev` window open (step 13) — the server is served over HTTP at `http://localhost:8080/mcp/`.

## B1. Wire the local server into Claude Code
Register the running HTTP server globally (user scope = available in every folder you open):

```powershell
npm install -g @anthropic-ai/claude-code
claude mcp add --transport http --scope user d365fo-mcp-tools http://localhost:8080/mcp/
```

Verify it is registered:

```powershell
claude mcp list
```

On first use Claude Code prompts you to **trust** the server — approve it. No separate "enable MCP" toggle is needed.

> Prefer editing config by hand? The same entry can be added to `%USERPROFILE%\.claude.json` under `mcpServers`:
> ```json
> {
>   "mcpServers": {
>     "d365fo-mcp-tools": {
>       "type": "http",
>       "url": "http://localhost:8080/mcp/"
>     }
>   }
> }
> ```

## B2. Project instructions (`CLAUDE.md`)
Claude Code walks up the directory tree from the opened folder and picks up `CLAUDE.md`. The repo ships the rules as `.github\copilot-instructions.md`; copy that file out as `CLAUDE.md` into the parent folder shared by all your D365FO solutions — every repo opened underneath inherits it:

```powershell
Copy-Item -Path ".github\copilot-instructions.md" -Destination "C:\Repos\CLAUDE.md"
```

For per-repo overrides, add a `CLAUDE.md` in the repo root — Claude Code merges all files found on the path (child wins on conflict). CHECK THE PATH matches where your `.sln` folders live.

## B3. Coding standards / skills (plugin)
The X++ coding standards and naming conventions ship as a Claude Code plugin in `.github\` of this repo. Install Claude Code and load the plugin once; it then applies to all sessions on the machine:

```powershell
claude --plugin-dir "C:\Repos\d365fo-mcp-server\.github"
```

After pulling repo updates, run `/reload-plugins` inside an active Claude Code session. The skill is invokable as `/d365fo-xpp:ang-xpp-dev`.

## B4. Test
Restart VS Code (`CTRL+SHIFT+N` for a fresh window), open the D365FO repo folder, open a new chat and ask:

`What tables contain a CustAccount field?`

You should see the call routed to **d365fo-mcp-tools**. If Claude Code uses built-in file/search tools instead, the `CLAUDE.md` from B2 is not in scope — verify it sits in the parent folder of the opened repo (e.g. `C:\Repos\CLAUDE.md`) or in the repo root, and that the `npm run dev` window is still running.

