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

Now wire the running server into your editor: **Copilot → Part B**, **Claude Code → Part Z**. You can do both.

## Part B — Wire into GitHub Copilot

14. `copy .mcp.json.example .mcp.json`

15. Go to github.com/settings/copilot/features → enable **MCP servers in Copilot**.

16. In Visual Studio: Tools → Options → GitHub → Copilot → enable "Enable MCP server integration in agent mode". Open Copilot Chat → switch to **Agent Mode** (not Ask or Edit).

17. Amend `.mcp.json` to:

    ```
    {
        "servers": {
          "d365fo-mcp-tools": {
            "url": "http://localhost:8080/mcp/"
          }
        }
    }
    ```

18. Run `Copy-Item -Path ".\.mcp.json" -Destination "$env:USERPROFILE\.mcp.json" -Force`

19. Place `.github` in a parent folder shared by all D365FO solutions:

    `Copy-Item -Path ".github" -Destination "C:\Repos\" -Recurse`

    > VS 2022 / VS Code search for `.github\copilot-instructions.md` upward from the `.sln` folder — one copy in a common parent covers all solutions underneath. CHECK THE PATH.

20. If you did the majority of the above through VS Code, restart it. Use `CTRL+SHIFT+N` for a new workspace. Open the folder with the whole repository, e.g. `C:\Repos\D365FO-Intax`.

    > The dedicated `npm run dev` window must remain open.

21. In VS Code chat, go to `Settings / Agent Customizations / MCP servers`, press `+`, select `HTTP`, paste `http://localhost:8080/mcp/`, choose **Global** — done. You should see your server under `MCP Servers - installed`.

22. **Time to test!** Open a new chat and ask `What tables contain a "CustAccount" field?`. You should see something that points directly to MCP usage.

---

# Part C — Claude Code (local MCP)

This is the Claude Code equivalent of **Part B** (Copilot). Do **Part A** first and keep the `npm run dev` window open (step 13) — the server is served over HTTP at `http://localhost:8080/mcp/`, the same endpoint Copilot uses.

## C1. Wire the local server into Claude Code
Register the running HTTP server globally (user scope = available in every folder you open):

```powershell
npm install -g @anthropic-ai/claude-code
claude mcp add --transport http --scope user d365fo-mcp-tools http://localhost:8080/mcp/
```

Verify it is registered:

```powershell
claude mcp list
```

On first use Claude Code prompts you to **trust** the server — approve it. No separate "enable MCP" toggle is needed (unlike Copilot in step 15).

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

## C2. Project instructions (`CLAUDE.md`)
Claude Code walks up the directory tree from the opened folder and picks up `CLAUDE.md` (the equivalent of Copilot's `.github\copilot-instructions.md` from step 19). Place it in the parent folder shared by all your D365FO solutions — every repo opened underneath inherits it:

```powershell
Copy-Item -Path ".github\copilot-instructions.md" -Destination "C:\Repos\CLAUDE.md"
```

For per-repo overrides, add a `CLAUDE.md` in the repo root — Claude Code merges all files found on the path (child wins on conflict). CHECK THE PATH matches where your `.sln` folders live.

## C3. Coding standards / skills (plugin)
The X++ coding standards and naming conventions ship as a Claude Code plugin in `.github\` of this repo. Install Claude Code and load the plugin once; it then applies to all sessions on the machine:

```powershell
claude --plugin-dir "C:\Repos\d365fo-mcp-server\.github"
```

After pulling repo updates, run `/reload-plugins` inside an active Claude Code session. The skill is invokable as `/d365fo-xpp:ang-xpp-dev`.

## C4. Test
Restart VS Code (`CTRL+SHIFT+N` for a fresh window), open the D365FO repo folder, open a new chat and ask:

`What tables contain a CustAccount field?`

You should see the call routed to **d365fo-mcp-tools**. If Claude Code uses built-in file/search tools instead, the `CLAUDE.md` from Z2 is not in scope — verify it sits in the parent folder of the opened repo (e.g. `C:\Repos\CLAUDE.md`) or in the repo root, and that the `npm run dev` window is still running.

