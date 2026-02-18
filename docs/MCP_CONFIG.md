# MCP Configuration (.mcp.json)

## Overview

The `.mcp.json` file provides context configuration for the MCP server, allowing automatic detection of workspace paths, project locations, and package directories. This eliminates the need to manually specify these paths in every tool call.

## Configuration Structure

```json
{
  "servers": {
    "xpp-completion": {
      "url": "http://localhost:3000/mcp/",
      "description": "X++ Code Completion Server for D365 F&O"
    },
    "context": {
      "workspacePath": "K:\\AOSService\\PackagesLocalDirectory\\YourModelName",
      "packagePath": "K:\\AOSService\\PackagesLocalDirectory"
    }
  }
}
```

> **Note:** `projectPath` and `solutionPath` are **optional** and typically auto-detected by GitHub Copilot from the active workspace. Only specify them explicitly if you need to override the auto-detection.

## Configuration Properties

### `context` Object

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `workspacePath` | string | No | Full path to your D365FO model directory in PackagesLocalDirectory |
| `packagePath` | string | No | Base path to PackagesLocalDirectory (auto-extracted from workspacePath if not provided) |
| `projectPath` | string | No | Full path to your Visual Studio `.rnrproj` project file (usually auto-detected by GitHub Copilot from active workspace) |
| `solutionPath` | string | No | Full path to your Visual Studio solution directory (usually auto-detected by GitHub Copilot from active workspace) |

### Property Details

#### `workspacePath`
- **Purpose:** Specifies the root directory of your custom D365FO model
- **Used by:** Workspace scanning, hybrid search, pattern analysis
- **Example:** `K:\\AOSService\\PackagesLocalDirectory\\AslCore`
- **Auto-extraction:** If this contains `PackagesLocalDirectory`, the server will automatically extract `packagePath`

#### `packagePath`
- **Purpose:** Base directory where all D365FO packages are stored
- **Used by:** `create_d365fo_file`, `modify_d365fo_file` tools
- **Example:** `K:\\AOSService\\PackagesLocalDirectory`
- **Default:** If not specified and `workspacePath` contains `PackagesLocalDirectory`, it will be auto-extracted
- **Manual override:** Use this if you have a non-standard PackagesLocalDirectory location

#### `projectPath`
- **Purpose:** Path to your Visual Studio project file for automatic ModelName extraction
- **Used by:** `create_d365fo_file` to auto-extract correct ModelName from `.rnrproj`
- **Example:** `K:\\VSProjects\\MySolution\\MyProject\\MyProject.rnrproj`
- **Critical:** Providing this prevents creating files in wrong models (like ApplicationSuite)
- **Auto-detection:** Usually auto-detected by GitHub Copilot from active workspace - only specify explicitly if you need to override

#### `solutionPath`
- **Purpose:** Path to Visual Studio solution directory
- **Used by:** `create_d365fo_file` when `projectPath` is not provided (searches for `.rnrproj` files)
- **Example:** `K:\\VSProjects\\MySolution`
- **Alternative:** Use this if you don't know the exact project file path
- **Auto-detection:** Usually auto-detected by GitHub Copilot from active workspace - only specify explicitly if you need to override

---

## How It Works

### 1. Server Startup

When the MCP server starts:

```typescript
console.log('⚙️  Loading .mcp.json configuration...');
const config = await initializeConfig();
if (config && config.servers.context) {
  console.log('✅ Configuration loaded from .mcp.json');
  if (config.servers.context.workspacePath) {
    console.log(`   Workspace path: ${config.servers.context.workspacePath}`);
  }
  if (config.servers.context.packagePath) {
    console.log(`   Package path: ${config.servers.context.packagePath}`);
  }
}
```

### 2. Path Resolution Priority

When `create_d365fo_file` needs a package path:

1. **Explicit `args.packagePath`** (highest priority)
   - If tool call includes `packagePath` parameter, use it directly
2. **Config `context.packagePath`**
   - If `.mcp.json` has explicit `packagePath`, use it
3. **Auto-extracted from `context.workspacePath`**
   - If `workspacePath` contains `PackagesLocalDirectory`, extract base path
4. **Default fallback**
   - Use `K:\AosService\PackagesLocalDirectory` as last resort

### 3. Console Output

When using configuration:

```
[create_d365fo_file] Using package path: K:\AOSService\PackagesLocalDirectory (from .mcp.json config)
```

When using defaults:

```
[create_d365fo_file] Using package path: K:\AOSService\PackagesLocalDirectory (default)
```

---

## Configuration File Locations

The server searches for `.mcp.json` in the following order:

1. Current working directory
2. Parent directories (up to 5 levels)
3. Fallback to current directory (may not exist)

### Recommended Locations

#### For Visual Studio 2022 Workspace

Place `.mcp.json` in your **solution root directory**:

```
K:\VSProjects\MySolution\
├── .mcp.json                     ← Place here
├── MySolution.sln
└── MyProject\
    └── MyProject.rnrproj
```

**Example configuration:**

```json
{
  "servers": {
    "xpp-completion": {
      "url": "http://localhost:3000/mcp/"
    },
    "context": {
      "workspacePath": "K:\\AOSService\\PackagesLocalDirectory\\AslCore",
      "projectPath": "K:\\VSProjects\\MySolution\\MyProject\\MyProject.rnrproj",
      "solutionPath": "K:\\VSProjects\\MySolution"
    }
  }
}
```

#### For User-Wide Configuration

Place `.mcp.json` in your **user profile directory**:

```
%USERPROFILE%\.mcp.json
```

This configuration applies to all D365FO workspaces for the current user.

---

## Usage Examples

### Example 1: Minimal Configuration (Recommended)

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

**Result:**
- `packagePath` is auto-extracted as `K:\AOSService\PackagesLocalDirectory`
- `projectPath` and `solutionPath` are auto-detected by GitHub Copilot from active workspace
- Server can create files in correct location without manual path specification

### Example 2: With Explicit Package Path

```json
{
  "servers": {
    "xpp-completion": {
      "url": "http://localhost:3000/mcp/"
    },
    "context": {
      "workspacePath": "K:\\AOSService\\PackagesLocalDirectory\\AslCore",
      "packagePath": "K:\\AOSService\\PackagesLocalDirectory"
    }
  }
}
```

**Result:**
- Explicit `packagePath` specified (prevents auto-extraction)
- `projectPath` and `solutionPath` still auto-detected by Copilot
- Useful when workspacePath doesn't contain PackagesLocalDirectory

### Example 3: Full Override (Rare Use Case)

```json
{
  "servers": {
    "xpp-completion": {
      "url": "http://localhost:3000/mcp/"
    },
    "context": {
      "workspacePath": "K:\\AOSService\\PackagesLocalDirectory\\AslCore",
      "packagePath": "K:\\AOSService\\PackagesLocalDirectory",
      "projectPath": "K:\\VSProjects\\D365FO\\AslProject\\AslProject.rnrproj",
      "solutionPath": "K:\\VSProjects\\D365FO"
    }
  }
}
```

**Result:**
- All paths explicitly defined (overrides Copilot auto-detection)
- Only needed if Copilot detection doesn't work correctly
- Most users don't need this level of explicit configuration

### Example 3: Non-standard PackagesLocalDirectory

```json
{
  "servers": {
    "xpp-completion": {
      "url": "http://localhost:3000/mcp/"
    },
    "context": {
      "workspacePath": "C:\\CustomPath\\D365Packages\\MyModel",
      "packagePath": "C:\\CustomPath\\D365Packages"
    }
  }
}
```

**Result:**
- Supports non-standard installation paths
- Manual `packagePath` override for custom setups

---

## Benefits

### ✅ Automatic Path Detection

No need to specify paths that GitHub Copilot already knows:

**Minimal config:**
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
- `packagePath`: Auto-extracted from `workspacePath`
- `projectPath`: Auto-detected by GitHub Copilot from active workspace
- `solutionPath`: Auto-detected by GitHub Copilot from active workspace

### ✅ Prevents Wrong Model Creation

The system automatically:
1. Detects active workspace path from GitHub Copilot
2. Finds `.rnrproj` file in workspace
3. Extracts actual `ModelName` from `<PropertyGroup><ModelName>`
4. Creates files in correct model (not Microsoft models)

**You only need to specify `workspacePath` in `.mcp.json` - everything else is automatic!**

### ✅ Workspace-Aware Features

With `workspacePath` configured:
- Hybrid search prioritizes your workspace files
- Pattern analysis learns from YOUR codebase
- Code completion includes your custom extensions

---

## Troubleshooting

### Configuration Not Loading

**Symptom:**
```
ℹ️  No .mcp.json configuration found, using defaults
```

**Solutions:**
1. Check file exists in solution directory or current working directory
2. Verify JSON syntax is valid (use JSON validator)
3. Check file name is exactly `.mcp.json` (not `mcp.json` or `.mcp.json.txt`)

### Path Not Being Used

**Symptom:**
```
[create_d365fo_file] Using package path: K:\AosService\PackagesLocalDirectory (default)
```

**Solutions:**
1. Check `context.packagePath` is specified in `.mcp.json`
2. Verify `workspacePath` includes `PackagesLocalDirectory` for auto-extraction
3. Restart MCP server to reload configuration

### Files Created in Wrong Model

**Symptom:**
```
❌ File created: K:\AosService\PackagesLocalDirectory\ApplicationSuite\...
```

**Solutions:**
1. Add `projectPath` or `solutionPath` to `.mcp.json` context
2. Ensure `.rnrproj` file contains correct `<ModelName>` property
3. Restart MCP server to reload configuration

---

## Related Documentation

- [FILE_CREATION_BEST_PRACTICES.md](./FILE_CREATION_BEST_PRACTICES.md) - Best practices for creating D365FO files
- [SETUP.md](./SETUP.md) - Initial server setup instructions
- [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md) - Tool usage examples

---

## Summary

`.mcp.json` configuration provides:
- ✅ Automatic path detection for `create_d365fo_file`
- ✅ Correct ModelName extraction from `.rnrproj`
- ✅ Workspace-aware code intelligence
- ✅ Prevents creating files in Microsoft models
- ✅ Leverages GitHub Copilot's workspace detection
- ✅ Minimal configuration required (just `workspacePath`)

**Recommended:** Create `.mcp.json` in your solution root directory with just `workspacePath` configured - GitHub Copilot handles the rest automatically!
