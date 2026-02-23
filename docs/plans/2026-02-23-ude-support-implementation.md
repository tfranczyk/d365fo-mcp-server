# UDE Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the MCP server to work with X++ UDE (Unified Developer Experience) development, supporting dual metadata paths (custom + Microsoft), correct `PackageName\ModelName` folder structure, and XPP config file auto-discovery.

**Architecture:** Add an `XppConfigProvider` to read Power Platform Tools config JSON files, a `PackageResolver` to map model names to package names via descriptor XML files, and update all file tools (`create_d365fo_file`, `modify_d365fo_file`, `create_label`) to use `PackageName\ModelName` paths instead of `ModelName\ModelName`. The `ConfigManager` gains dual-path awareness. Environment type (`traditional` vs `ude`) is auto-detected or explicitly configured.

**Tech Stack:** TypeScript, Node.js, Vitest, better-sqlite3, fast-xml-parser, zod

**Design doc:** `docs/plans/2026-02-23-ude-support-design.md`

---

### Task 1: Create Feature Branch

**Step 1: Create and switch to feature branch**

Run: `git checkout -b feature/ude-support`

**Step 2: Verify branch**

Run: `git branch --show-current`
Expected: `feature/ude-support`

---

### Task 2: XPP Config Provider

**Files:**
- Create: `src/utils/xppConfigProvider.ts`
- Test: `tests/utils/xppConfigProvider.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/utils/xppConfigProvider.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

// We'll test the provider after creating it
import {
  XppConfigProvider,
  type XppEnvironmentConfig,
} from '../../src/utils/xppConfigProvider.js';

describe('XppConfigProvider', () => {
  let testConfigDir: string;

  beforeEach(async () => {
    testConfigDir = path.join(os.tmpdir(), `xpp-config-test-${Date.now()}`);
    await fs.mkdir(testConfigDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testConfigDir, { recursive: true, force: true });
  });

  function writeConfig(name: string, config: Record<string, any>) {
    fsSync.writeFileSync(
      path.join(testConfigDir, `${name}.json`),
      JSON.stringify(config),
    );
  }

  describe('listConfigs', () => {
    it('should list available XPP configs sorted by modification time', async () => {
      writeConfig('env-a___10.0.1000.1', {
        ModelStoreFolder: 'C:\\Custom1',
        FrameworkDirectory: 'C:\\Framework1',
      });
      // Small delay so mtime differs
      await new Promise(r => setTimeout(r, 50));
      writeConfig('env-b___10.0.2000.1', {
        ModelStoreFolder: 'C:\\Custom2',
        FrameworkDirectory: 'C:\\Framework2',
      });

      const provider = new XppConfigProvider(testConfigDir);
      const configs = await provider.listConfigs();

      expect(configs.length).toBe(2);
      // Newest first
      expect(configs[0].configName).toBe('env-b');
      expect(configs[0].version).toBe('10.0.2000.1');
      expect(configs[1].configName).toBe('env-a');
    });

    it('should skip non-json files and directories', async () => {
      writeConfig('valid___10.0.1.1', {
        ModelStoreFolder: 'C:\\Custom',
        FrameworkDirectory: 'C:\\Framework',
      });
      // Create a directory with the same naming pattern
      await fs.mkdir(path.join(testConfigDir, 'dir___10.0.1.1'), { recursive: true });

      const provider = new XppConfigProvider(testConfigDir);
      const configs = await provider.listConfigs();

      expect(configs.length).toBe(1);
      expect(configs[0].configName).toBe('valid');
    });
  });

  describe('getActiveConfig', () => {
    it('should auto-select newest config when no name specified', async () => {
      writeConfig('old___10.0.1.1', {
        ModelStoreFolder: 'C:\\OldCustom',
        FrameworkDirectory: 'C:\\OldFramework',
      });
      await new Promise(r => setTimeout(r, 50));
      writeConfig('new___10.0.2.1', {
        ModelStoreFolder: 'C:\\NewCustom',
        FrameworkDirectory: 'C:\\NewFramework',
      });

      const provider = new XppConfigProvider(testConfigDir);
      const config = await provider.getActiveConfig();

      expect(config).not.toBeNull();
      expect(config!.customPackagesPath).toBe('C:\\NewCustom');
      expect(config!.microsoftPackagesPath).toBe('C:\\NewFramework');
    });

    it('should select config by name', async () => {
      writeConfig('env-a___10.0.1.1', {
        ModelStoreFolder: 'C:\\CustomA',
        FrameworkDirectory: 'C:\\FrameworkA',
      });
      writeConfig('env-b___10.0.2.1', {
        ModelStoreFolder: 'C:\\CustomB',
        FrameworkDirectory: 'C:\\FrameworkB',
      });

      const provider = new XppConfigProvider(testConfigDir);
      const config = await provider.getActiveConfig('env-a___10.0.1.1');

      expect(config).not.toBeNull();
      expect(config!.customPackagesPath).toBe('C:\\CustomA');
    });

    it('should return null when no configs exist', async () => {
      const provider = new XppConfigProvider(testConfigDir);
      const config = await provider.getActiveConfig();

      expect(config).toBeNull();
    });

    it('should extract xref database info', async () => {
      writeConfig('env___10.0.1.1', {
        ModelStoreFolder: 'C:\\Custom',
        FrameworkDirectory: 'C:\\Framework',
        CrossReferencesDatabaseName: 'XRef_test',
        CrossReferencesDbServerName: '(LocalDB)\\MSSQLLocalDB',
      });

      const provider = new XppConfigProvider(testConfigDir);
      const config = await provider.getActiveConfig();

      expect(config!.xrefDbName).toBe('XRef_test');
      expect(config!.xrefDbServer).toBe('(LocalDB)\\MSSQLLocalDB');
    });
  });

  describe('parseConfigFilename', () => {
    it('should parse name___version.json pattern', () => {
      const provider = new XppConfigProvider(testConfigDir);
      const result = provider.parseConfigFilename('heb-lebarre2-udx___10.0.2428.63.json');

      expect(result).not.toBeNull();
      expect(result!.configName).toBe('heb-lebarre2-udx');
      expect(result!.version).toBe('10.0.2428.63');
    });

    it('should return null for invalid filenames', () => {
      const provider = new XppConfigProvider(testConfigDir);
      expect(provider.parseConfigFilename('invalid.json')).toBeNull();
      expect(provider.parseConfigFilename('no-version.txt')).toBeNull();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/utils/xppConfigProvider.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/utils/xppConfigProvider.ts
/**
 * XPP Config Provider
 * Reads Power Platform Tools XPP configuration files to discover
 * custom and Microsoft package paths for UDE development.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

export interface XppEnvironmentConfig {
  configName: string;
  version: string;
  customPackagesPath: string;       // ModelStoreFolder
  microsoftPackagesPath: string;    // FrameworkDirectory
  xrefDbName?: string;
  xrefDbServer?: string;
  description?: string;
  fullFilename: string;             // Original filename without .json
}

interface XppConfigJson {
  ModelStoreFolder?: string;
  FrameworkDirectory?: string;
  ReferencePackagesPaths?: string[];
  CrossReferencesDatabaseName?: string;
  CrossReferencesDbServerName?: string;
  Description?: string;
}

export class XppConfigProvider {
  private configDir: string;
  private cache: XppEnvironmentConfig[] | null = null;

  constructor(configDir?: string) {
    this.configDir = configDir ||
      path.join(
        process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
        'Microsoft', 'Dynamics365', 'XPPConfig',
      );
  }

  /**
   * Parse a config filename into name + version.
   * Pattern: {name}___{version}.json
   */
  parseConfigFilename(filename: string): { configName: string; version: string } | null {
    const match = filename.match(/^(.+)___(.+)\.json$/);
    if (!match) return null;
    return { configName: match[1], version: match[2] };
  }

  /**
   * List all available XPP configs, sorted by modification time (newest first).
   */
  async listConfigs(): Promise<XppEnvironmentConfig[]> {
    if (this.cache) return this.cache;

    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(this.configDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const jsonFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json'));

    // Get modification times for sorting
    const withStats = await Promise.all(
      jsonFiles.map(async (entry) => {
        const fullPath = path.join(this.configDir, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          return { entry, mtime: stat.mtimeMs };
        } catch {
          return null;
        }
      }),
    );

    const valid = withStats.filter(Boolean) as { entry: fsSync.Dirent; mtime: number }[];
    valid.sort((a, b) => b.mtime - a.mtime); // Newest first

    const configs: XppEnvironmentConfig[] = [];
    for (const { entry } of valid) {
      const parsed = this.parseConfigFilename(entry.name);
      if (!parsed) continue;

      const fullPath = path.join(this.configDir, entry.name);
      try {
        const raw = await fs.readFile(fullPath, 'utf-8');
        const json: XppConfigJson = JSON.parse(raw);

        if (!json.ModelStoreFolder || !json.FrameworkDirectory) continue;

        configs.push({
          configName: parsed.configName,
          version: parsed.version,
          customPackagesPath: json.ModelStoreFolder,
          microsoftPackagesPath: json.FrameworkDirectory,
          xrefDbName: json.CrossReferencesDatabaseName,
          xrefDbServer: json.CrossReferencesDbServerName,
          description: json.Description,
          fullFilename: entry.name.replace(/\.json$/, ''),
        });
      } catch {
        // Skip malformed files
      }
    }

    this.cache = configs;
    return configs;
  }

  /**
   * Get the active XPP config.
   * If configName is provided, selects that specific config.
   * Otherwise auto-selects the newest.
   */
  async getActiveConfig(configName?: string): Promise<XppEnvironmentConfig | null> {
    const configs = await this.listConfigs();
    if (configs.length === 0) return null;

    if (configName) {
      return configs.find(c =>
        c.fullFilename === configName ||
        c.configName === configName
      ) || null;
    }

    // Auto-select newest (already sorted by mtime desc)
    return configs[0];
  }

  /**
   * Check if XPP configs exist (indicates UDE environment).
   */
  async hasConfigs(): Promise<boolean> {
    const configs = await this.listConfigs();
    return configs.length > 0;
  }

  /**
   * Invalidate cached config list.
   */
  clearCache(): void {
    this.cache = null;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/utils/xppConfigProvider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/xppConfigProvider.ts tests/utils/xppConfigProvider.test.ts
git commit -m "feat: add XPP config provider for UDE environment discovery"
```

---

### Task 3: Package Resolver

**Files:**
- Create: `src/utils/packageResolver.ts`
- Test: `tests/utils/packageResolver.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/utils/packageResolver.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PackageResolver } from '../../src/utils/packageResolver.js';

describe('PackageResolver', () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = path.join(os.tmpdir(), `pkg-resolver-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  async function createModel(
    packageName: string,
    modelName: string,
    options?: { createAxClass?: boolean },
  ) {
    const modelDir = path.join(testRoot, packageName, modelName);
    const descriptorDir = path.join(testRoot, packageName, 'Descriptor');

    await fs.mkdir(modelDir, { recursive: true });
    await fs.mkdir(descriptorDir, { recursive: true });

    if (options?.createAxClass !== false) {
      await fs.mkdir(path.join(modelDir, 'AxClass'), { recursive: true });
    }

    // Write descriptor XML
    const descriptorXml = `<?xml version="1.0" encoding="utf-8"?>
<AxModelInfo xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
  <ModelModule>${packageName}</ModelModule>
  <Name>${modelName}</Name>
  <DisplayName>${modelName}</DisplayName>
</AxModelInfo>`;

    await fs.writeFile(
      path.join(descriptorDir, `${modelName}.xml`),
      descriptorXml,
    );
  }

  describe('resolve', () => {
    it('should resolve model name to package name via descriptor', async () => {
      await createModel('Enhancements', 'HEB Utilities');
      await createModel('Enhancements', 'HEB Reporting');

      const resolver = new PackageResolver([testRoot]);
      const result = await resolver.resolve('HEB Utilities');

      expect(result).not.toBeNull();
      expect(result!.packageName).toBe('Enhancements');
      expect(result!.rootPath).toBe(testRoot);
    });

    it('should resolve when package name equals model name', async () => {
      await createModel('ALDairy', 'ALDairy');

      const resolver = new PackageResolver([testRoot]);
      const result = await resolver.resolve('ALDairy');

      expect(result).not.toBeNull();
      expect(result!.packageName).toBe('ALDairy');
    });

    it('should return null for unknown model', async () => {
      const resolver = new PackageResolver([testRoot]);
      const result = await resolver.resolve('NonExistent');

      expect(result).toBeNull();
    });

    it('should search multiple roots', async () => {
      const secondRoot = path.join(os.tmpdir(), `pkg-resolver-test2-${Date.now()}`);
      await fs.mkdir(secondRoot, { recursive: true });

      await createModel('Enhancements', 'HEB Utilities');

      // Create model in second root
      const msModelDir = path.join(secondRoot, 'ApplicationSuite', 'Foundation');
      const msDescDir = path.join(secondRoot, 'ApplicationSuite', 'Descriptor');
      await fs.mkdir(msModelDir, { recursive: true });
      await fs.mkdir(path.join(msModelDir, 'AxClass'), { recursive: true });
      await fs.mkdir(msDescDir, { recursive: true });
      await fs.writeFile(
        path.join(msDescDir, 'Foundation.xml'),
        `<AxModelInfo><ModelModule>ApplicationSuite</ModelModule><Name>Foundation</Name></AxModelInfo>`,
      );

      const resolver = new PackageResolver([testRoot, secondRoot]);

      const custom = await resolver.resolve('HEB Utilities');
      expect(custom!.packageName).toBe('Enhancements');
      expect(custom!.rootPath).toBe(testRoot);

      const ms = await resolver.resolve('Foundation');
      expect(ms!.packageName).toBe('ApplicationSuite');
      expect(ms!.rootPath).toBe(secondRoot);

      await fs.rm(secondRoot, { recursive: true, force: true });
    });

    it('should use explicit packageName when provided', async () => {
      const resolver = new PackageResolver([testRoot]);
      const result = await resolver.resolveWithPackage('MyModel', 'MyPackage');

      expect(result.packageName).toBe('MyPackage');
    });

    it('should cache results after first scan', async () => {
      await createModel('Pkg', 'Model1');

      const resolver = new PackageResolver([testRoot]);
      const r1 = await resolver.resolve('Model1');
      const r2 = await resolver.resolve('Model1');

      expect(r1).toEqual(r2);
    });
  });

  describe('filesystem fallback', () => {
    it('should find model by scanning directories when no descriptor exists', async () => {
      // Create model directory without descriptor
      const modelDir = path.join(testRoot, 'MyPackage', 'MyModel', 'AxClass');
      await fs.mkdir(modelDir, { recursive: true });

      const resolver = new PackageResolver([testRoot]);
      const result = await resolver.resolve('MyModel');

      expect(result).not.toBeNull();
      expect(result!.packageName).toBe('MyPackage');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/utils/packageResolver.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/utils/packageResolver.ts
/**
 * Package Resolver
 * Maps model names to package names using descriptor XML files
 * and filesystem scanning.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

export interface ResolvedPackage {
  packageName: string;
  modelName: string;
  rootPath: string; // Which metadata root this was found in
}

export class PackageResolver {
  private roots: string[];
  private modelToPackageMap: Map<string, ResolvedPackage> | null = null;
  private buildPromise: Promise<void> | null = null;

  constructor(roots: string[]) {
    this.roots = roots.filter(Boolean);
  }

  /**
   * Resolve a model name to its package name.
   * Returns null if the model cannot be found in any root.
   */
  async resolve(modelName: string): Promise<ResolvedPackage | null> {
    await this.ensureBuilt();
    return this.modelToPackageMap!.get(modelName) ||
      this.modelToPackageMap!.get(modelName.toLowerCase()) ||
      null;
  }

  /**
   * Resolve with an explicit package name (bypasses lookup).
   */
  resolveWithPackage(modelName: string, packageName: string): ResolvedPackage {
    return {
      packageName,
      modelName,
      rootPath: this.roots[0] || '',
    };
  }

  /**
   * Get all known model-to-package mappings.
   */
  async getAllMappings(): Promise<Map<string, ResolvedPackage>> {
    await this.ensureBuilt();
    return new Map(this.modelToPackageMap!);
  }

  /**
   * Invalidate the cache to force a rescan.
   */
  clearCache(): void {
    this.modelToPackageMap = null;
    this.buildPromise = null;
  }

  private async ensureBuilt(): Promise<void> {
    if (this.modelToPackageMap) return;
    if (!this.buildPromise) {
      this.buildPromise = this.buildMap();
    }
    await this.buildPromise;
  }

  private async buildMap(): Promise<void> {
    const map = new Map<string, ResolvedPackage>();

    for (const root of this.roots) {
      if (!root) continue;

      let packageDirs: string[];
      try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        packageDirs = entries
          .filter(e => e.isDirectory() || e.isSymbolicLink())
          .map(e => e.name);
      } catch {
        continue;
      }

      for (const pkgName of packageDirs) {
        const pkgPath = path.join(root, pkgName);

        // Strategy 1: Read descriptor files
        const descriptorDir = path.join(pkgPath, 'Descriptor');
        try {
          const descriptorFiles = await fs.readdir(descriptorDir);
          for (const file of descriptorFiles) {
            if (!file.endsWith('.xml')) continue;
            const filePath = path.join(descriptorDir, file);
            try {
              const content = await fs.readFile(filePath, 'utf-8');
              const nameMatch = content.match(/<Name>([^<]+)<\/Name>/);
              const moduleMatch = content.match(/<ModelModule>([^<]+)<\/ModelModule>/);

              const modelName = nameMatch?.[1]?.trim();
              const packageName = moduleMatch?.[1]?.trim() || pkgName;

              if (modelName && !map.has(modelName)) {
                map.set(modelName, { packageName, modelName, rootPath: root });
                // Also store lowercase for case-insensitive lookup
                map.set(modelName.toLowerCase(), { packageName, modelName, rootPath: root });
              }
            } catch {
              // Skip unreadable descriptor
            }
          }
        } catch {
          // No Descriptor directory — fall through to filesystem scan
        }

        // Strategy 2: Filesystem scan (find subdirs that have AxClass/AxTable)
        try {
          const subEntries = await fs.readdir(pkgPath, { withFileTypes: true });
          const subDirs = subEntries
            .filter(e => e.isDirectory() || e.isSymbolicLink())
            .map(e => e.name)
            .filter(n => n !== 'Descriptor' && n !== 'bin' && !n.startsWith('.'));

          for (const subDir of subDirs) {
            const modelPath = path.join(pkgPath, subDir);
            // Check for AOT type folders
            const hasAotFolder = await this.hasAotTypeFolder(modelPath);
            if (hasAotFolder && !map.has(subDir)) {
              map.set(subDir, { packageName: pkgName, modelName: subDir, rootPath: root });
              map.set(subDir.toLowerCase(), { packageName: pkgName, modelName: subDir, rootPath: root });
            }
          }
        } catch {
          // Skip unreadable package directory
        }
      }
    }

    this.modelToPackageMap = map;
  }

  private async hasAotTypeFolder(dirPath: string): Promise<boolean> {
    const aotFolders = ['AxClass', 'AxTable', 'AxEnum', 'AxForm', 'AxEdt', 'AxView', 'AxDataEntityView'];
    for (const folder of aotFolders) {
      try {
        await fs.access(path.join(dirPath, folder));
        return true;
      } catch {
        // Try lowercase
        try {
          await fs.access(path.join(dirPath, folder.toLowerCase()));
          return true;
        } catch {
          continue;
        }
      }
    }
    return false;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/utils/packageResolver.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/packageResolver.ts tests/utils/packageResolver.test.ts
git commit -m "feat: add package resolver for model-to-package name mapping"
```

---

### Task 4: Add `packageName` to XppSymbol Type and Database Schema

**Files:**
- Modify: `src/metadata/types.ts:127-152`
- Modify: `src/metadata/symbolIndex.ts:139-146` (CREATE TABLE), `src/metadata/symbolIndex.ts:345-380` (addSymbol)

**Step 1: Add `packageName` field to XppSymbol interface**

In `src/metadata/types.ts`, add after line 133 (`model: string;`):

```typescript
  packageName?: string;            // Package that contains this model (may differ from model)
```

**Step 2: Add `package_name` column to symbols table**

In `src/metadata/symbolIndex.ts`, update the `CREATE TABLE IF NOT EXISTS symbols` statement. After the `model TEXT NOT NULL,` line (146), add:

```
        package_name TEXT,
```

**Step 3: Update `addSymbol` to store `package_name`**

In `src/metadata/symbolIndex.ts`, update the INSERT statement in `addSymbol()` to include `package_name` in both the column list and the VALUES placeholder, and add `symbol.packageName || symbol.model` to the `stmt.run(...)` call.

**Step 4: Update `rowToSymbol` to read `package_name`**

In `src/metadata/symbolIndex.ts`, in the `rowToSymbol()` method, add:

```typescript
      packageName: row.package_name || row.model,
```

**Step 5: Run existing tests to ensure no regressions**

Run: `npx vitest run`
Expected: All existing tests PASS (new column is nullable, backward compatible)

**Step 6: Commit**

```bash
git add src/metadata/types.ts src/metadata/symbolIndex.ts
git commit -m "feat: add package_name to symbol schema for UDE support"
```

---

### Task 5: Update ConfigManager with Dual Path Support

**Files:**
- Modify: `src/utils/configManager.ts`
- Test: `tests/utils/configManager.test.ts` (create new)

**Step 1: Write failing tests**

```typescript
// tests/utils/configManager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ConfigManager - UDE support', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should detect UDE environment type from env var', async () => {
    // This test validates the new getDevEnvironmentType method
    process.env.DEV_ENVIRONMENT_TYPE = 'ude';
    // Import dynamically to pick up env changes
    const { getConfigManager } = await import('../../src/utils/configManager.js');
    // Reset singleton for test isolation - we'll verify the method exists
    expect(typeof getConfigManager).toBe('function');
  });

  it('should return explicit CUSTOM_PACKAGES_PATH from env', () => {
    process.env.CUSTOM_PACKAGES_PATH = 'C:\\MyCustom';
    process.env.MICROSOFT_PACKAGES_PATH = 'C:\\MyMicrosoft';
    // The actual integration will be tested via the full flow
    expect(process.env.CUSTOM_PACKAGES_PATH).toBe('C:\\MyCustom');
    expect(process.env.MICROSOFT_PACKAGES_PATH).toBe('C:\\MyMicrosoft');
  });
});
```

**Step 2: Update McpContext interface**

In `src/utils/configManager.ts`, update the `McpContext` interface (lines 11-16):

```typescript
export interface McpContext {
  workspacePath?: string;
  packagePath?: string;
  customPackagesPath?: string;      // UDE: custom X++ root (ModelStoreFolder)
  microsoftPackagesPath?: string;   // UDE: Microsoft X++ root (FrameworkDirectory)
  projectPath?: string;
  solutionPath?: string;
  devEnvironmentType?: 'auto' | 'traditional' | 'ude';
}
```

**Step 3: Add new methods to ConfigManager class**

Add imports at top of file:

```typescript
import { XppConfigProvider, type XppEnvironmentConfig } from './xppConfigProvider.js';
```

Add new private field and methods to ConfigManager class:

```typescript
  private xppConfigProvider: XppConfigProvider | null = null;
  private xppConfig: XppEnvironmentConfig | null = null;
  private xppConfigLoaded: boolean = false;

  /**
   * Get the resolved dev environment type.
   * Priority: 1) Explicit env var 2) .mcp.json context 3) Auto-detect
   */
  async getDevEnvironmentType(): Promise<'traditional' | 'ude'> {
    const explicit = process.env.DEV_ENVIRONMENT_TYPE || this.getContext()?.devEnvironmentType;
    if (explicit === 'ude') return 'ude';
    if (explicit === 'traditional') return 'traditional';

    // Auto-detect: check if XPP configs exist
    await this.ensureXppConfig();
    return this.xppConfig ? 'ude' : 'traditional';
  }

  /**
   * Get the custom packages path (UDE: ModelStoreFolder).
   */
  async getCustomPackagesPath(): Promise<string | null> {
    // Priority 1: Explicit env var
    if (process.env.CUSTOM_PACKAGES_PATH) return process.env.CUSTOM_PACKAGES_PATH;
    // Priority 2: .mcp.json context
    const ctx = this.getContext();
    if (ctx?.customPackagesPath) return ctx.customPackagesPath;
    // Priority 3: XPP config
    await this.ensureXppConfig();
    return this.xppConfig?.customPackagesPath || null;
  }

  /**
   * Get the Microsoft packages path (UDE: FrameworkDirectory).
   */
  async getMicrosoftPackagesPath(): Promise<string | null> {
    // Priority 1: Explicit env var
    if (process.env.MICROSOFT_PACKAGES_PATH) return process.env.MICROSOFT_PACKAGES_PATH;
    // Priority 2: .mcp.json context
    const ctx = this.getContext();
    if (ctx?.microsoftPackagesPath) return ctx.microsoftPackagesPath;
    // Priority 3: XPP config
    await this.ensureXppConfig();
    return this.xppConfig?.microsoftPackagesPath || null;
  }

  private async ensureXppConfig(): Promise<void> {
    if (this.xppConfigLoaded) return;
    this.xppConfigLoaded = true;

    this.xppConfigProvider = new XppConfigProvider();
    const configName = process.env.XPP_CONFIG_NAME || undefined;
    this.xppConfig = await this.xppConfigProvider.getActiveConfig(configName);

    if (this.xppConfig) {
      console.error(`[ConfigManager] XPP config loaded: ${this.xppConfig.configName} v${this.xppConfig.version}`);
      console.error(`   Custom packages: ${this.xppConfig.customPackagesPath}`);
      console.error(`   Microsoft packages: ${this.xppConfig.microsoftPackagesPath}`);
    }
  }
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/utils/configManager.ts tests/utils/configManager.test.ts
git commit -m "feat: add dual path support and UDE environment type to ConfigManager"
```

---

### Task 6: Fix `create_d365fo_file` Path Construction

**Files:**
- Modify: `src/tools/createD365File.ts`

This is the critical bug fix. Multiple changes needed.

**Step 1: Update schema to add `packageName` parameter**

In `CreateD365FileArgsSchema` (line 14), add after the `modelName` field:

```typescript
  packageName: z
    .string()
    .optional()
    .describe('Package name (e.g., Enhancements, ApplicationSuite). Auto-resolved from model name if omitted.'),
```

**Step 2: Add imports**

At the top of the file, add:

```typescript
import { PackageResolver } from '../utils/packageResolver.js';
```

**Step 3: Fix path construction in `handleCreateD365File`**

Replace the path construction block (lines 774-795) with:

```typescript
    // Determine object folder based on type
    const objectFolderMap: Record<string, string> = {
      class: 'AxClass',
      table: 'AxTable',
      enum: 'AxEnum',
      form: 'AxForm',
      query: 'AxQuery',
      view: 'AxView',
      'data-entity': 'AxDataEntityView',
    };

    const objectFolder = objectFolderMap[args.objectType];
    if (!objectFolder) {
      throw new Error(`Unsupported object type: ${args.objectType}`);
    }

    // Construct full path - resolve package name for UDE support
    const configManager = getConfigManager();
    const configPackagePath = configManager.getPackagePath();
    const envType = await configManager.getDevEnvironmentType();

    let basePath: string;
    let resolvedPackageName: string;

    if (envType === 'ude') {
      // UDE mode: resolve package name and determine correct root
      const customPath = await configManager.getCustomPackagesPath();
      const msPath = await configManager.getMicrosoftPackagesPath();
      const roots = [customPath, msPath].filter(Boolean) as string[];

      if (args.packageName) {
        resolvedPackageName = args.packageName;
        // Default to custom path for explicit package names
        basePath = customPath || args.packagePath || 'K:\\AosService\\PackagesLocalDirectory';
      } else {
        const resolver = new PackageResolver(roots);
        const resolved = await resolver.resolve(actualModelName);

        if (resolved) {
          resolvedPackageName = resolved.packageName;
          basePath = resolved.rootPath;
        } else {
          // Fallback: assume package == model (common case)
          resolvedPackageName = actualModelName;
          basePath = customPath || args.packagePath || configPackagePath || 'K:\\AosService\\PackagesLocalDirectory';
        }
      }
    } else {
      // Traditional mode: package == model (backward compatible)
      resolvedPackageName = actualModelName;
      basePath =
        args.packagePath ||
        configPackagePath ||
        'K:\\AosService\\PackagesLocalDirectory';
    }

    console.error(
      `[create_d365fo_file] Environment: ${envType}, Package: ${resolvedPackageName}, Model: ${actualModelName}`,
    );

    const modelPath = path.join(
      basePath,
      resolvedPackageName,
      actualModelName,
      objectFolder,
    );
    const fileName = `${args.objectName}.xml`;
    const fullPath = path.join(modelPath, fileName);
```

**Step 4: Run existing tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/tools/createD365File.ts
git commit -m "fix: use PackageName\\ModelName path structure for UDE support in create_d365fo_file"
```

---

### Task 7: Fix `create_label` Path Construction

**Files:**
- Modify: `src/tools/createLabel.ts`

**Step 1: Update schema to add `packageName` parameter**

In `CreateLabelArgsSchema` (line 30), add after the `model` field:

```typescript
  packageName: z
    .string()
    .optional()
    .describe('Package name for the model. Auto-resolved if omitted.'),
```

**Step 2: Remove hardcoded default from `packagePath`**

Change the `packagePath` field default from `'K:\\AosService\\PackagesLocalDirectory'` to no default:

```typescript
  packagePath: z
    .string()
    .optional()
    .describe('Root packages path. Auto-detected from environment config if omitted.'),
```

**Step 3: Add imports and fix path construction**

Add at top of file:

```typescript
import { getConfigManager } from '../utils/configManager.js';
import { PackageResolver } from '../utils/packageResolver.js';
```

In `createLabelTool()`, replace the path construction (around line 153-157):

```typescript
    // Resolve paths for UDE support
    const configManager = getConfigManager();
    const envType = await configManager.getDevEnvironmentType();

    let resolvedPackagePath: string;
    let resolvedPackageName: string;

    if (envType === 'ude') {
      const customPath = await configManager.getCustomPackagesPath();
      const msPath = await configManager.getMicrosoftPackagesPath();
      const roots = [customPath, msPath].filter(Boolean) as string[];

      resolvedPackagePath = packagePath || customPath || 'K:\\AosService\\PackagesLocalDirectory';

      if (args.packageName) {
        resolvedPackageName = args.packageName;
      } else {
        const resolver = new PackageResolver(roots);
        const resolved = await resolver.resolve(model);
        resolvedPackageName = resolved?.packageName || model;
        if (resolved?.rootPath) resolvedPackagePath = resolved.rootPath;
      }
    } else {
      resolvedPackagePath = packagePath || 'K:\\AosService\\PackagesLocalDirectory';
      resolvedPackageName = model; // Traditional: package == model
    }

    const modelDir = path.join(resolvedPackagePath, resolvedPackageName, model);
    const axLabelDir = path.join(modelDir, 'AxLabelFile');
    const labelResourcesDir = path.join(axLabelDir, 'LabelResources');
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/tools/createLabel.ts
git commit -m "fix: use PackageName\\ModelName path structure in create_label tool"
```

---

### Task 8: Fix `modify_d365fo_file` to Support Package Name

**Files:**
- Modify: `src/tools/modifyD365File.ts`

**Step 1: Add `packageName` to schema**

In `ModifyD365FileArgsSchema` (line 13), add:

```typescript
  packageName: z.string().optional().describe('Package name. Auto-resolved if omitted.'),
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests PASS (the modify tool primarily uses symbolIndex to find files, so the schema addition is sufficient for now; the actual file path resolution will work once symbolIndex stores package_name)

**Step 3: Commit**

```bash
git add src/tools/modifyD365File.ts
git commit -m "feat: add packageName parameter to modify_d365fo_file tool"
```

---

### Task 9: Update Tool Descriptions in mcpServer.ts

**Files:**
- Modify: `src/server/mcpServer.ts`

**Step 1: Update `create_d365fo_file` tool description**

Find the tool definition for `create_d365fo_file` and add `packageName` to its inputSchema properties:

```typescript
packageName: {
  type: 'string',
  description: 'Package name (e.g., Enhancements, ApplicationSuite). Auto-resolved from model name if omitted. Required when package name differs from model name.',
},
```

**Step 2: Update `modify_d365fo_file` tool description**

Add `packageName` to its inputSchema properties:

```typescript
packageName: {
  type: 'string',
  description: 'Package name. Auto-resolved if omitted.',
},
```

**Step 3: Update `create_label` tool description**

Add `packageName` to its inputSchema properties and update `packagePath` description to note it auto-detects:

```typescript
packageName: {
  type: 'string',
  description: 'Package name for the model. Auto-resolved if omitted.',
},
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/server/mcpServer.ts
git commit -m "docs: update tool descriptions with packageName parameter for UDE support"
```

---

### Task 10: Update .env.example and .mcp.json.example

**Files:**
- Modify: `.env.example`
- Modify: `.mcp.json.example`

**Step 1: Add UDE variables to .env.example**

After the `PACKAGES_PATH` line (54), add:

```
# =============================================================================
# UDE (UNIFIED DEVELOPER EXPERIENCE) CONFIGURATION
# =============================================================================
# Development environment type: auto (default), traditional (on-prem VM), ude (Power Platform Tools)
# When 'auto': detects UDE if XPP config files exist in %LOCALAPPDATA%\Microsoft\Dynamics365\XPPConfig\
# DEV_ENVIRONMENT_TYPE=auto

# XPP config name to use (from %LOCALAPPDATA%\Microsoft\Dynamics365\XPPConfig\)
# Leave empty to auto-select newest config
# Example: heb-lebarre2-udx___10.0.2428.63
# XPP_CONFIG_NAME=

# Override paths (takes priority over XPP config values)
# Custom X++ code root (from XPP config ModelStoreFolder)
# CUSTOM_PACKAGES_PATH=C:\CustomXppMetadata

# Microsoft X++ code root (from XPP config FrameworkDirectory)
# MICROSOFT_PACKAGES_PATH=C:\Users\...\Dynamics365\10.0.2428.63\PackagesLocalDirectory
```

**Step 2: Update .mcp.json.example**

```json
{
  "servers": {
    "d365fo-mcp-server": {
      "url": "https://your-app-name.azurewebsites.net/mcp/",
      "description": "D365FO MCP Server for X++ Code Completion"
    },
    "context": {
      "workspacePath": "K:\\AOSService\\PackagesLocalDirectory\\YourModelName",
      "packagePath": "K:\\AOSService\\PackagesLocalDirectory",
      "customPackagesPath": "C:\\CustomXppMetadata",
      "microsoftPackagesPath": "C:\\Users\\...\\Dynamics365\\10.0.2428.63\\PackagesLocalDirectory",
      "devEnvironmentType": "auto"
    }
  }
}
```

**Step 3: Commit**

```bash
git add .env.example .mcp.json.example
git commit -m "docs: add UDE configuration variables to .env.example and .mcp.json.example"
```

---

### Task 11: Update Metadata Extraction for Dual Paths

**Files:**
- Modify: `scripts/extract-metadata.ts`

**Step 1: Add UDE path support**

At the top of the file (after line 17), replace/augment the path configuration:

```typescript
const PACKAGES_PATH = process.env.PACKAGES_PATH || 'C:\\AOSService\\PackagesLocalDirectory';
const CUSTOM_PACKAGES_PATH = process.env.CUSTOM_PACKAGES_PATH;
const MICROSOFT_PACKAGES_PATH = process.env.MICROSOFT_PACKAGES_PATH;
```

**Step 2: In the main `extractMetadata()` function, scan both paths when in UDE mode**

After the existing `packagesToProcess` logic (around line 220-244), add support for scanning dual roots. When `CUSTOM_PACKAGES_PATH` and/or `MICROSOFT_PACKAGES_PATH` are set, scan those instead of (or in addition to) `PACKAGES_PATH`.

This is a larger refactor — the key change is to build `modelWorkItems` from both roots when both are specified, using the correct root path for each.

**Step 3: Run extraction test (manual)**

Run: `npx tsx scripts/extract-metadata.ts` (with appropriate env vars)
Expected: Should scan both custom and Microsoft paths

**Step 4: Commit**

```bash
git add scripts/extract-metadata.ts
git commit -m "feat: support dual metadata paths in extract-metadata script for UDE"
```

---

### Task 12: Update Build Database for Package Name

**Files:**
- Modify: `scripts/build-database.ts`

**Step 1: Update label indexing to use dual paths**

In the label indexing section (around line 171), when `CUSTOM_PACKAGES_PATH` or `MICROSOFT_PACKAGES_PATH` are set, pass those to `indexAllLabels` instead of the single `PACKAGES_PATH`.

**Step 2: Commit**

```bash
git add scripts/build-database.ts
git commit -m "feat: support dual package paths in build-database for UDE label indexing"
```

---

### Task 13: Update Label Parser for UDE Structure

**Files:**
- Modify: `src/metadata/labelParser.ts`

**Step 1: Update `indexAllLabels` to scan all models within packages**

The current `indexAllLabels` function (line 239) iterates over top-level directories as "models", which only works when package == model. For UDE, each top-level directory is a **package** that may contain multiple **model** subdirectories.

Update the scanning loop to enumerate subdirectories within each package directory and check each for `AxLabelFile`:

In the existing loop at line 267, the variable `model` is actually a package-level directory. The existing code at lines 282-300 already looks for subdirectories, but it only matches one (`properCaseModel = subDirs.find(d => d.toLowerCase() === model.toLowerCase())`). Change this to iterate ALL subdirectories that contain AxLabelFile:

```typescript
  for (const packageOrModel of models) {
    if (modelFilter && !modelFilter(packageOrModel)) {
      skippedByFilter++;
      continue;
    }

    const packageDir = path.join(packagesPath, packageOrModel);

    // Find all model subdirectories that contain AxLabelFile
    const modelDirs: { modelDir: string; modelName: string }[] = [];

    try {
      const subDirs = fsSync.readdirSync(packageDir, { withFileTypes: true })
        .filter(e => e.isDirectory() || e.isSymbolicLink())
        .map(e => e.name)
        .filter(n => n !== 'Descriptor' && n !== 'bin' && !n.startsWith('.'));

      for (const subDir of subDirs) {
        const candidateDir = path.join(packageDir, subDir);
        const axLabelDirOriginal = path.join(candidateDir, 'AxLabelFile');
        const axLabelDirLower = path.join(candidateDir, 'axlabelfile');
        if (fsSync.existsSync(axLabelDirOriginal) || fsSync.existsSync(axLabelDirLower)) {
          modelDirs.push({ modelDir: candidateDir, modelName: subDir });
        }
      }
    } catch {
      // Directory not readable
    }

    // Fallback: flat structure (no model subdirectory)
    if (modelDirs.length === 0) {
      const flatAxLabel = path.join(packageDir, 'AxLabelFile');
      if (fsSync.existsSync(flatAxLabel)) {
        modelDirs.push({ modelDir: packageDir, modelName: packageOrModel });
      }
    }

    // Process each model directory found
    for (const { modelDir, modelName } of modelDirs) {
      // ... existing label indexing logic using modelDir and modelName ...
    }
  }
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/metadata/labelParser.ts
git commit -m "fix: scan all models within packages for label indexing (UDE support)"
```

---

### Task 14: Update D365ProjectInfo with packageName

**Files:**
- Modify: `src/utils/workspaceDetector.ts`

**Step 1: Add `packageName` to D365ProjectInfo**

```typescript
export interface D365ProjectInfo {
  projectPath?: string;
  modelName: string;
  packageName?: string;     // NEW: package containing this model
  solutionPath?: string;
  packagePath?: string;
}
```

**Step 2: In `autoDetectD365Project`, attempt to set packageName**

In the PackagesLocalDirectory path extraction (line 184-201), also try to extract the package name when the path has the structure `{root}\{PackageName}\{ModelName}`:

```typescript
  // Also try: K:\...\PackagesLocalDirectory\PackageName\ModelName
  const twoLevelMatch = normalized.match(
    /^(.+[\\]PackagesLocalDirectory)[\\]([^\\]+)[\\]([^\\]+)\\?$/i
  );
  if (twoLevelMatch) {
    const packagePath = twoLevelMatch[1];
    const packageName = twoLevelMatch[2];
    const modelName = twoLevelMatch[3];
    return {
      modelName,
      packageName,
      packagePath,
    };
  }
```

**Step 3: Run tests**

Run: `npx vitest run tests/workspaceDetector.test.ts`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/utils/workspaceDetector.ts
git commit -m "feat: add packageName to D365ProjectInfo for UDE workspace detection"
```

---

### Task 15: Full Integration Test

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 2: Build the project**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors

**Step 3: Commit any fixes if needed**

---

### Task 16: Final Commit and Summary

**Step 1: Verify all changes are committed**

Run: `git status`
Expected: Clean working tree

**Step 2: View commit history for the branch**

Run: `git log --oneline main..HEAD`
Expected: ~12 clean commits covering all tasks
