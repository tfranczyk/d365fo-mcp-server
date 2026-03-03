/**
 * Tests for silent catch error handling
 *
 * Covers three tools that have try/catch blocks around extension_metadata queries:
 *  - tableExtensionInfoTool   (tableExtensionInfo.ts)
 *  - analyzeExtensionPointsTool (analyzeExtensionPoints.ts)
 *  - findEventHandlersTool    (findEventHandlers.ts)
 *
 * Each tool gracefully handles:
 *  1. Missing extension_metadata table (older DB schema)
 *  2. DB with extension_metadata present and data
 *  3. DEBUG_LOGGING=true emits a console.warn
 *  4. Other errors are still logged (not silently swallowed)
 *
 * We use a real in-memory XppSymbolIndex. To simulate a missing table we
 * DROP extension_metadata after construction (the constructor creates it).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { XppSymbolIndex } from '../../src/metadata/symbolIndex.js';
import { tableExtensionInfoTool } from '../../src/tools/tableExtensionInfo.js';
import { analyzeExtensionPointsTool } from '../../src/tools/analyzeExtensionPoints.js';
import { findEventHandlersTool } from '../../src/tools/findEventHandlers.js';
import type { XppServerContext } from '../../src/types/context.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTmpIdx(): { idx: XppSymbolIndex; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silent-test-'));
  const idx = new XppSymbolIndex(path.join(dir, 'test.db'));
  return {
    idx,
    cleanup: () => {
      try { idx.close(); } catch { /**/ }
      // On Windows, SQLite WAL/SHM files may still be held briefly after close().
      // Swallow EPERM so cleanup failures don't leak env vars to subsequent tests.
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /**/ }
    },
  };
}

function makeContext(idx: XppSymbolIndex): XppServerContext {
  return {
    symbolIndex: idx,
    cache: { get: async () => null, getFuzzy: async () => null, set: async () => {}, generateSearchKey: () => 'k' } as any,
    parser: {} as any,
    workspaceScanner: {} as any,
    hybridSearch: {} as any,
    termRelationshipGraph: {} as any,
  };
}

function req(toolName: string, args: Record<string, unknown>) {
  return { method: 'tools/call', params: { name: toolName, arguments: args } } as any;
}

// ── tableExtensionInfoTool ─────────────────────────────────────────────────────

describe('tableExtensionInfoTool – silent catch', () => {
  let env: ReturnType<typeof makeTmpIdx>;

  beforeEach(() => {
    env = makeTmpIdx();
    // Add a base table symbol
    env.idx.addSymbol({ name: 'CustTable', type: 'table', filePath: '/t.xml', model: 'App' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore spies and env BEFORE cleanup — on Windows rmSync may throw EPERM
    // on SQLite WAL files; we don't want that to leak env/spy state to next test.
    vi.restoreAllMocks();
    delete process.env.DEBUG_LOGGING;
    env.cleanup();
  });

  it('does not throw when extension_metadata table is missing', async () => {
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    await expect(
      tableExtensionInfoTool(req('table_extension_info', { tableName: 'CustTable' }), makeContext(env.idx))
    ).resolves.not.toThrow();
  });

  it('returns a valid text response even without extension_metadata', async () => {
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    const result = await tableExtensionInfoTool(
      req('table_extension_info', { tableName: 'CustTable' }),
      makeContext(env.idx)
    );
    const text: string = result.content[0].text;
    expect(text).toContain('CustTable');
    // "No table extensions found" is an acceptable fallback message
    expect(text).toMatch(/No table extensions found|Extension/);
  });

  it('emits console.warn when DEBUG_LOGGING=true and table is missing', async () => {
    process.env.DEBUG_LOGGING = 'true';
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    await tableExtensionInfoTool(
      req('table_extension_info', { tableName: 'CustTable' }),
      makeContext(env.idx)
    );

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('tableExtensionInfo'),
      expect.anything()
    );
  });

  it('does NOT emit console.warn when DEBUG_LOGGING is not set', async () => {
    delete process.env.DEBUG_LOGGING;
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    await tableExtensionInfoTool(
      req('table_extension_info', { tableName: 'CustTable' }),
      makeContext(env.idx)
    );

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns correct extension data when extension_metadata is present', async () => {
    // Seed extension metadata
    env.idx.db.prepare(
      `INSERT INTO extension_metadata (extension_name, extension_type, base_object_name, added_fields, model)
       VALUES (?, ?, ?, ?, ?)`
    ).run('CustTable_Extension1', 'table-extension', 'CustTable', JSON.stringify(['MyField1', 'MyField2']), 'Custom');

    const result = await tableExtensionInfoTool(
      req('table_extension_info', { tableName: 'CustTable' }),
      makeContext(env.idx)
    );
    const text: string = result.content[0].text;
    expect(text).toContain('CustTable_Extension1');
    expect(text).toContain('MyField1');
    expect(text).toContain('MyField2');
  });

  it('returns "No table extensions found" for a table with no extensions', async () => {
    const result = await tableExtensionInfoTool(
      req('table_extension_info', { tableName: 'CustTable' }),
      makeContext(env.idx)
    );
    const text: string = result.content[0].text;
    expect(text).toContain('No table extensions found');
  });
});

// ── analyzeExtensionPointsTool ─────────────────────────────────────────────────

describe('analyzeExtensionPointsTool – silent catch', () => {
  let env: ReturnType<typeof makeTmpIdx>;

  beforeEach(() => {
    env = makeTmpIdx();
    env.idx.addSymbol({ name: 'SalesLine', type: 'class', filePath: '/c.xml', model: 'App' });
    env.idx.addSymbol({ name: 'insert', type: 'method', filePath: '/c.xml', model: 'App',
      parentName: 'SalesLine', signature: 'public void insert()' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DEBUG_LOGGING;
    env.cleanup();
  });

  it('does not throw when extension_metadata table is missing', async () => {
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    await expect(
      analyzeExtensionPointsTool(
        req('analyze_extension_points', { objectName: 'SalesLine', showExistingExtensions: true }),
        makeContext(env.idx)
      )
    ).resolves.not.toThrow();
  });

  it('returns analysis even without extension_metadata', async () => {
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    const result = await analyzeExtensionPointsTool(
      req('analyze_extension_points', { objectName: 'SalesLine', showExistingExtensions: true }),
      makeContext(env.idx)
    );
    expect(result.content[0].text).toContain('SalesLine');
  });

  it('emits warn with tool name in message when DEBUG_LOGGING=true and table missing', async () => {
    process.env.DEBUG_LOGGING = 'true';
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    await analyzeExtensionPointsTool(
      req('analyze_extension_points', { objectName: 'SalesLine', showExistingExtensions: true }),
      makeContext(env.idx)
    );

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('analyzeExtensionPoints'),
      expect.anything()
    );
  });

  it('shows existing extensions when extension_metadata is present', async () => {
    env.idx.db.prepare(
      `INSERT INTO extension_metadata (extension_name, extension_type, base_object_name, coc_methods, event_subscriptions, added_methods, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('SalesLine_Extension', 'class-extension', 'SalesLine',
      JSON.stringify(['insert']), JSON.stringify([]), JSON.stringify([]), 'Custom');

    const result = await analyzeExtensionPointsTool(
      req('analyze_extension_points', { objectName: 'SalesLine', showExistingExtensions: true }),
      makeContext(env.idx)
    );
    const text: string = result.content[0].text;
    expect(text).toContain('SalesLine_Extension');
  });
});

// ── findEventHandlersTool ──────────────────────────────────────────────────────

describe('findEventHandlersTool – silent catch', () => {
  let env: ReturnType<typeof makeTmpIdx>;

  beforeEach(() => {
    env = makeTmpIdx();
    env.idx.addSymbol({ name: 'CustTable', type: 'table', filePath: '/t.xml', model: 'App' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DEBUG_LOGGING;
    env.cleanup();
  });

  it('does not throw when extension_metadata table is missing', async () => {
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    await expect(
      findEventHandlersTool(
        req('find_event_handlers', { targetTable: 'CustTable' }),
        makeContext(env.idx)
      )
    ).resolves.not.toThrow();
  });

  it('returns valid text response even without extension_metadata', async () => {
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    const result = await findEventHandlersTool(
      req('find_event_handlers', { targetTable: 'CustTable' }),
      makeContext(env.idx)
    );
    const text: string = result.content[0].text;
    expect(text).toContain('CustTable');
  });

  it('emits warn with tool name when DEBUG_LOGGING=true and table missing', async () => {
    process.env.DEBUG_LOGGING = 'true';
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    await findEventHandlersTool(
      req('find_event_handlers', { targetTable: 'CustTable' }),
      makeContext(env.idx)
    );

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('findEventHandlers'),
      expect.anything()
    );
  });

  it('does NOT emit warn when DEBUG_LOGGING is absent', async () => {
    delete process.env.DEBUG_LOGGING;
    env.idx.db.exec('DROP TABLE IF EXISTS extension_metadata');

    await findEventHandlersTool(
      req('find_event_handlers', { targetTable: 'CustTable' }),
      makeContext(env.idx)
    );

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('finds event handlers via SubscribesTo when symbols are present', async () => {
    // Add a method with SubscribesTo in its source_snippet
    env.idx.addSymbol({
      name: 'onInserted_Handler',
      type: 'method',
      filePath: '/handler.xml',
      model: 'Custom',
      parentName: 'CustTableEventHandler',
      sourceSnippet: '[SubscribesTo(tableStr(CustTable), eventStr(Inserted))]\npublic static void onInserted_Handler()',
    });

    const result = await findEventHandlersTool(
      req('find_event_handlers', { targetTable: 'CustTable' }),
      makeContext(env.idx)
    );
    const text: string = result.content[0].text;
    expect(text).toContain('CustTableEventHandler');
  });
});
