### For Administrators 
# Deploy your "D365FnO MCP for X++" support

## Considerations
This instruction is intended to help you build and deploy your MCP server. MCP server will be one of a helpful instances to support your work as D365FnO developer or consultant.
D365FnO MCP for X++ will:
1) answer the questions about your code

D365FnO MCP will **not**:
1) answer a question how does the process work in D365FnO.

# Instruction
1) On your VM, in PowerShell (admin mode)

`Install-Module -Name d365fo.tools`

and allow for all...

2) `Install-D365SupportingSoftware -Name vscode,python`

>if node.js fails so you need to download and install it manually https://nodejs.org/en

> go for REPAIR 

3) after successful installation goto `edit the system environment variables', find your path and edit the one for npm to the target folder of your installation, might be C:\Program Files\nodejs\

4) reopen your terminal as Admin

5) navigate to the path again, run `npm install`

> check \bridge\D365MetadataBridge\Program.cs against the _packagesPath

6) navigate to `bridge\D365MetadataBridge` and run `dotnet build -c Release -p:D365BinPath="J:\AosService\PackagesLocalDirectory\bin`

7) copy `.env.example` with:

    cd ..\..
    copy .env.example .env

7) amend `.env` and set PACKAGES_PATH, CUSTOM_MODELS, LABEL_LANGUAGES

7) run `npm run extract-metadata` and wait. It takes ~15mins.

7) run `npm run build-database` and wait less than above.

7) run `npm run build`, just a second

7) run `copy .mcp.json.example .mcp.json`

7) Go to github.com/settings/copilot/features → enable MCP servers in Copilot

7) In Visual Studio: Tools → Options → GitHub → Copilot → enable "Enable MCP server integration in agent mode"
Open Copilot Chat → switch to Agent Mode (not Ask or Edit)

7) amend `.mcp.json` to 

```
{
    "servers": {
      "d365fo-mcp-tools": {
        "url": "http://localhost:8080/mcp/"
      }
    }
}
```

16) run `Copy-Item -Path ".\.mcp.json" -Destination "$env:USERPROFILE\.mcp.json" -Force`

16) open a dedicated new terminal, run `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`

16) run `npm run dev` in the dedicated window (preferably PowerShell). Keep it opened.

16) in the previous terminal place .github in a parent folder shared by all D365FO solutions `Copy-Item -Path ".github" -Destination "C:\Repos\" -Recurse`
> VS 2022 searches for .github\copilot-instructions.md upward from the .sln folder — one copy in a common parent covers all solutions underneath. CHECK THE PATH.


20. If you have done the majority of above through Visual Studio Code, it's time to restart it. Use `CTRL+SHIFT+N` for new workspace. Open folder with the whole repository, i.e. `C:\Repos\D365FO-Intax`.
> The dedicated terminal window must remain opened. 

> TODO:  I've probably did sth wrong with the config of 21st, but no point to go further.

21. In VS code, chat, go to `Settings / Agent Customizations / MCP servers\`, press `+`, select `HTTP` and paste `http://localhost:8080/mcp/`, go for Global and you're done. You should see your server under `MCP Servers - installed`.

21. **Time to test!** Open new chat and ask `What tables contain "CustAccount" field?`. You should see sth that points out directly to MCP usage.

