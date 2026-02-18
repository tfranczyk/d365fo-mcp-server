# Automatic Workspace Detection

## How It Works

When you use GitHub Copilot in Visual Studio 2022 with a D365FO workspace, the system **automatically detects** your project without any configuration:

1. **Active workspace path** - GitHub Copilot provides the current workspace directory
2. **Automatic .rnrproj search** - MCP server recursively searches for `.rnrproj` files in the workspace
3. **Model name extraction** - Automatically extracts `<Model>` (or fallback `<ModelName>`) from the found `.rnrproj` file
4. **Solution path detection** - Derives solution path from project file location

## What This Means for You

### ✅ NEW WAY (Automatic - NO Configuration Needed!)

**Just open your D365FO project in Visual Studio or VS Code - that's it!**

```
Open VS 2022 with D365FO solution
↓
GitHub Copilot detects workspace
↓
MCP server finds .rnrproj automatically
↓
ModelName extracted automatically
↓
Files created in correct location automatically
```

**No .mcp.json needed!** The server will:
- Search for `.rnrproj` files in your workspace
- Extract `ModelName` from the project file
- Use correct paths for file creation
- Work seamlessly across different projects

### Configuration Only for Special Cases

You only need `.mcp.json` configuration in these scenarios:

1. **Multiple D365FO projects** in one solution (specify which to use)
2. **Non-standard PackagesLocalDirectory** location
3. **Override auto-detection** for specific needs

```json
{
  "servers": {
    "xpp-completion": {
      "url": "http://localhost:3000/mcp/"
    },
    "context": {
      "workspacePath": "K:\\AOSService\\PackagesLocalDirectory\\AslCore",
      "packagePath": "K:\\AOSService\\PackagesLocalDirectory",
      "projectPath": "K:\\VSProjects\\MySolution\\MyProject\\MyProject.rnrproj",
      "solutionPath": "K:\\VSProjects\\MySolution"
    }
  }
}
```

### ✅ New Way (Automatic Detection)

```json
{
  "servers": {
    "xpp-completion": {
      "url": "http://localhost:3000/mcp/"
    },
    "context": {
      "workspacePath": "K:\\AOSService\\PackagesLocalDirectory\\AslCore"
    }
  }
}
```

**What happens automatically:**
- `packagePath`: Extracted from `workspacePath`
- `projectPath`: Detected from Copilot's active workspace
- `solutionPath`: Detected from Copilot's active workspace

#### Optional .mcp.json Configuration

Only needed for special cases (multiple projects, overrides, etc.):

```json
{
  "servers": {
    "d365fo-mcp-server": {
      "url": "http://localhost:3000/mcp/"
    },
    "context": {
      "projectPath": "K:\\VSProjects\\MySolution\\SpecificProject\\SpecificProject.rnrproj",
      "packagePath": "K:\\AOSService\\PackagesLocalDirectory"
    }
  }
}
```

**Note:** `projectPath` and `solutionPath` are now **OPTIONAL** - auto-detection will be used if not specified.

## Auto-Detection in Action

### Console Output (Successful Auto-Detection)

When creating a D365FO file with auto-detection enabled, you'll see:

```
[WorkspaceDetector] Searching for .rnrproj files in: K:\VSProjects\MySolution
[WorkspaceDetector] Found 1 .rnrproj file(s):
   - K:\VSProjects\MySolution\MyProject\MyProject.rnrproj
[WorkspaceDetector] ✅ Detected D365FO project:
   Project: K:\VSProjects\MySolution\MyProject\MyProject.rnrproj
   Model: AslCore
   Solution: K:\VSProjects\MySolution

[create_d365fo_file] Using projectPath (auto-detected or from .mcp.json): K:\VSProjects\MySolution\MyProject\MyProject.rnrproj
[create_d365fo_file] Extracted ModelName from projectPath: AslCore
[create_d365fo_file] Final ModelName to use: AslCore (auto-extracted ✓)
```

### Console Output (Failed Auto-Detection)

If no .rnrproj files are found:

```
[WorkspaceDetector] Searching for .rnrproj files in: C:\SomeFolder
[WorkspaceDetector] No .rnrproj files found in workspace
[create_d365fo_file] ⚠️ WARNING: No projectPath or solutionPath available
[create_d365fo_file] ⚠️ Using modelName AS-IS: "auto"
❌ ERROR: modelName "auto" appears to be a placeholder value!
```

## Path Resolution Priority

When `create_d365fo_file` is called, paths are resolved in this order:

1. **Tool arguments** - Explicitly provided `projectPath`/`solutionPath` in the tool call
2. **.mcp.json config** - Configured `projectPath`/`solutionPath` in the config file
3. **✨ AUTO-DETECTION** - Automatic search for `.rnrproj` files in workspace (NEW!)
4. **Fallback** - Use `modelName` AS-IS (⚠️ may be wrong - will show error for suspicious names)

You'll see in the console:

```
[create_d365fo_file] Using projectPath from .mcp.json config: K:\VSProjects\MySolution\MyProject\MyProject.rnrproj
[create_d365fo_file] Extracted ModelName from projectPath: AslCore
[create_d365fo_file] Using package path: K:\AOSService\PackagesLocalDirectory (from .mcp.json config)
```

## When to Override Auto-Detection

### Scenario 1: Multi-Project Solution

If your solution has multiple D365FO projects and Copilot detects the wrong one:

```json
{
  "context": {
    "workspacePath": "K:\\AOSService\\PackagesLocalDirectory\\AslCore",
    "projectPath": "K:\\VSProjects\\MySolution\\SpecificProject\\SpecificProject.rnrproj"
  }
}
```

### Scenario 2: Non-Standard Structure

If your workspace structure is non-standard:

```json
{
  "context": {
    "workspacePath": "C:\\CustomLocation\\D365Packages\\MyModel",
    "packagePath": "C:\\CustomLocation\\D365Packages",
    "projectPath": "C:\\Projects\\MyProject.rnrproj"
  }
}
```

### Scenario 3: Remote Development

If you're developing remotely and local paths don't match:

```json
{
  "context": {
    "workspacePath": "\\\\RemoteServer\\D365\\PackagesLocalDirectory\\MyModel",
    "packagePath": "\\\\RemoteServer\\D365\\PackagesLocalDirectory",
    "projectPath": "\\\\RemoteServer\\Projects\\MyProject.rnrproj"
  }
}
```

## Benefits

### ✅ Minimal Configuration

Only specify what's essential:

```json
{
  "context": {
    "workspacePath": "K:\\AOSService\\PackagesLocalDirectory\\AslCore"
  }
}
```

Everything else is automatic!

### ✅ No Manual Path Management

- No need to update paths when moving projects
- No need to specify project paths for each developer
- Works out-of-the-box with standard D365FO structure

### ✅ Prevents Configuration Drift

- Copilot always uses the actual active workspace
- No risk of creating files in wrong location due to outdated config
- Configuration stays simple and maintainable

## Troubleshooting

### Detection Not Working?

**Check console output:**

```
[create_d365fo_file] ⚠️ WARNING: No projectPath or solutionPath available (not in args, not in .mcp.json)!
```

**Solution:** Add explicit `projectPath` or `solutionPath` to `.mcp.json`:

```json
{
  "context": {
    "workspacePath": "K:\\AOSService\\PackagesLocalDirectory\\AslCore",
    "projectPath": "K:\\VSProjects\\MySolution\\MyProject\\MyProject.rnrproj"
  }
}
```

### Wrong Model Being Used?

**Check console output:**

```
[create_d365fo_file] Final ModelName to use: ApplicationSuite (as-is, NOT auto-extracted ⚠️)
```

**This means:** No `.rnrproj` file was found/detected.

**Solution:**
1. Verify `.rnrproj` exists in workspace
2. Add explicit `projectPath` to `.mcp.json`
3. Ensure workspace is open in Visual Studio

### Files Created in Microsoft Model?

**Path pattern:**

```
❌ K:\AosService\PackagesLocalDirectory\ApplicationSuite\ApplicationSuite\AxClass\...
```

**This means:** ModelName extraction failed.

**Solution:**
1. Check `.rnrproj` contains `<PropertyGroup><ModelName>AslCore</ModelName></PropertyGroup>`
2. Add explicit `projectPath` to `.mcp.json`
3. Restart MCP server to reload configuration

## Related Documentation

- [MCP_CONFIG.md](./MCP_CONFIG.md) - Complete configuration guide
- [FILE_CREATION_BEST_PRACTICES.md](./FILE_CREATION_BEST_PRACTICES.md) - Best practices for file creation
