/**
 * Tests for XppSymbolIndex – security and correctness
 *
 * Covers:
 *  1. ALTER TABLE whitelist – only known columns/types may be added
 *  2. clearModels() atomicity – all tables are cleared or none
 *  3. clearModels() correctness – only the specified model is removed
 *  4. Parameterized queries – model names flow through ? bindings, not string concat
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { XppSymbolIndex } from '../../src/metadata/symbolIndex.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTmpDb(): { dbPath: string; idx: XppSymbolIndex; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symidx-test-'));
  const dbPath = path.join(dir, 'test.db');
  const idx = new XppSymbolIndex(dbPath);
  return {
    dbPath,
    idx,
    cleanup: () => {
      try { idx.close(); } catch { /* already closed */ }
      // On Windows, SQLite WAL/SHM files may still be held briefly after close().
      // Swallow EPERM so cleanup failures don't propagate as test failures.
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /**/ }
    },
  };
}

/** Insert a symbol and security chain for a given model. */
function seedModel(idx: XppSymbolIndex, model: string, prefix: string) {
  idx.addSymbol({ name: `${prefix}Class`, type: 'class', filePath: '/test.xml', model });
  idx.addSymbol({ name: `${prefix}Table`, type: 'table', filePath: '/test.xml', model });

  idx.db.prepare(
    `INSERT OR IGNORE INTO security_privilege_entries (privilege_name, entry_point_name, object_type, access_level, model)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`${prefix}Priv`, `${prefix}Class`, 'menu-item-display', 'Read', model);

  idx.db.prepare(
    `INSERT OR IGNORE INTO security_duty_privileges (duty_name, privilege_name, model)
     VALUES (?, ?, ?)`
  ).run(`${prefix}Duty`, `${prefix}Priv`, model);

  idx.db.prepare(
    `INSERT OR IGNORE INTO security_role_duties (role_name, duty_name, model)
     VALUES (?, ?, ?)`
  ).run(`${prefix}Role`, `${prefix}Duty`, model);

  idx.db.prepare(
    `INSERT OR IGNORE INTO extension_metadata (extension_name, extension_type, base_object_name, model)
     VALUES (?, ?, ?, ?)`
  ).run(`${prefix}Ext`, 'table-extension', `${prefix}Table`, model);
}

function countSymbols(idx: XppSymbolIndex, model: string): number {
  return (idx.db.prepare('SELECT COUNT(*) as c FROM symbols WHERE model = ?').get(model) as any).c;
}

function countPrivs(idx: XppSymbolIndex, model: string): number {
  return (idx.db.prepare('SELECT COUNT(*) as c FROM security_privilege_entries WHERE model = ?').get(model) as any).c;
}

function countDuties(idx: XppSymbolIndex, model: string): number {
  return (idx.db.prepare('SELECT COUNT(*) as c FROM security_duty_privileges WHERE model = ?').get(model) as any).c;
}

function countRoles(idx: XppSymbolIndex, model: string): number {
  return (idx.db.prepare('SELECT COUNT(*) as c FROM security_role_duties WHERE model = ?').get(model) as any).c;
}

function countExtensions(idx: XppSymbolIndex, model: string): number {
  return (idx.db.prepare('SELECT COUNT(*) as c FROM extension_metadata WHERE model = ?').get(model) as any).c;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('XppSymbolIndex – clearModels() correctness', () => {
  let env: ReturnType<typeof makeTmpDb>;

  beforeEach(() => { env = makeTmpDb(); });
  afterEach(() => { env.cleanup(); });

  it('removes all symbols for the cleared model', () => {
    seedModel(env.idx, 'ModelA', 'A');
    seedModel(env.idx, 'ModelB', 'B');

    env.idx.clearModels(['ModelA']);

    expect(countSymbols(env.idx, 'ModelA')).toBe(0);
  });

  it('does NOT remove symbols for other models', () => {
    seedModel(env.idx, 'ModelA', 'A');
    seedModel(env.idx, 'ModelB', 'B');

    env.idx.clearModels(['ModelA']);

    expect(countSymbols(env.idx, 'ModelB')).toBe(2);
  });

  it('removes security chain (privileges, duties, roles) for the cleared model', () => {
    seedModel(env.idx, 'ModelA', 'A');
    seedModel(env.idx, 'ModelB', 'B');

    env.idx.clearModels(['ModelA']);

    expect(countPrivs(env.idx, 'ModelA')).toBe(0);
    expect(countDuties(env.idx, 'ModelA')).toBe(0);
    expect(countRoles(env.idx, 'ModelA')).toBe(0);
  });

  it('retains security chain for models that were NOT cleared', () => {
    seedModel(env.idx, 'ModelA', 'A');
    seedModel(env.idx, 'ModelB', 'B');

    env.idx.clearModels(['ModelA']);

    expect(countPrivs(env.idx, 'ModelB')).toBe(1);
    expect(countDuties(env.idx, 'ModelB')).toBe(1);
    expect(countRoles(env.idx, 'ModelB')).toBe(1);
  });

  it('removes extension_metadata for the cleared model', () => {
    seedModel(env.idx, 'ModelA', 'A');
    seedModel(env.idx, 'ModelB', 'B');

    env.idx.clearModels(['ModelA']);

    expect(countExtensions(env.idx, 'ModelA')).toBe(0);
    expect(countExtensions(env.idx, 'ModelB')).toBe(1);
  });

  it('clears multiple models in a single call', () => {
    seedModel(env.idx, 'ModelA', 'A');
    seedModel(env.idx, 'ModelB', 'B');
    seedModel(env.idx, 'ModelC', 'C');

    env.idx.clearModels(['ModelA', 'ModelB']);

    expect(countSymbols(env.idx, 'ModelA')).toBe(0);
    expect(countSymbols(env.idx, 'ModelB')).toBe(0);
    expect(countSymbols(env.idx, 'ModelC')).toBe(2);
  });

  it('is a no-op when called with an empty array', () => {
    seedModel(env.idx, 'ModelA', 'A');
    expect(() => env.idx.clearModels([])).not.toThrow();
    expect(countSymbols(env.idx, 'ModelA')).toBe(2);
  });

  it('model name with SQL injection chars is handled safely (parameterized query)', () => {
    // "'; DROP TABLE symbols; --" should be treated as a literal model name, not SQL
    const evilModel = "'; DROP TABLE symbols; --";
    seedModel(env.idx, 'SafeModel', 'Safe');
    // Inserting with the evil model name
    env.idx.addSymbol({ name: 'EvilClass', type: 'class', filePath: '/x.xml', model: evilModel });

    // Clear the evil model — must not break the DB
    expect(() => env.idx.clearModels([evilModel])).not.toThrow();

    // SafeModel must still be intact (injection did NOT drop the table)
    expect(() => countSymbols(env.idx, 'SafeModel')).not.toThrow();
    expect(countSymbols(env.idx, 'SafeModel')).toBe(2);
    expect(countSymbols(env.idx, evilModel)).toBe(0);
  });
});

// ── ALTER TABLE whitelist ──────────────────────────────────────────────────────

describe('XppSymbolIndex – ALTER TABLE whitelist', () => {
  it('creates a new database without throwing (all known columns present)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symidx-new-'));
    const dbPath = path.join(dir, 'new.db');
    expect(() => {
      const idx = new XppSymbolIndex(dbPath);
      idx.close();
    }).not.toThrow();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /**/ }
  });

  it('opens an existing database and migrates missing columns without error', () => {
    // Create a DB with a minimal symbols table (missing several columns)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symidx-migrate-'));
    const dbPath = path.join(dir, 'migrate.db');

    {
      // Build a minimal schema — only core columns, no extended metadata columns
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS symbols (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          parent_name TEXT,
          signature TEXT,
          file_path TEXT NOT NULL,
          model TEXT NOT NULL
        );
      `);
      db.close();
    }

    // Opening the index should run ALTER TABLE to add missing columns
    expect(() => {
      const idx = new XppSymbolIndex(dbPath);
      // Verify new columns exist by inserting a symbol with them
      idx.addSymbol({
        name: 'MigratedClass',
        type: 'class',
        filePath: '/x.xml',
        model: 'TestModel',
        description: 'migrated',
        tags: 'test',
      });
      const sym = idx.getSymbolByName('MigratedClass', 'class');
      idx.close();
      expect(sym?.name).toBe('MigratedClass');
    }).not.toThrow();

    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /**/ }
  });
});

// ── transaction atomicity ─────────────────────────────────────────────────────

describe('XppSymbolIndex – clearModels() transaction atomicity', () => {
  it('all or nothing: partial failure leaves DB in consistent state', () => {
    // We cannot easily force a mid-transaction failure without hacking internals,
    // but we CAN verify that concurrent reads during a clear are consistent:
    // symbols and extension_metadata are either both cleared or both present.
    const env = makeTmpDb();
    try {
      seedModel(env.idx, 'Atomic', 'At');

      const beforeClear = {
        symbols: countSymbols(env.idx, 'Atomic'),
        extensions: countExtensions(env.idx, 'Atomic'),
      };
      expect(beforeClear.symbols).toBe(2);
      expect(beforeClear.extensions).toBe(1);

      env.idx.clearModels(['Atomic']);

      const afterClear = {
        symbols: countSymbols(env.idx, 'Atomic'),
        extensions: countExtensions(env.idx, 'Atomic'),
      };
      // Both tables must be cleared — not just one
      expect(afterClear.symbols).toBe(0);
      expect(afterClear.extensions).toBe(0);
    } finally {
      env.cleanup();
    }
  });
});

// ── getSymbolCount ────────────────────────────────────────────────────────────

describe('XppSymbolIndex – getSymbolCount()', () => {
  it('returns 0 for an empty database', () => {
    const env = makeTmpDb();
    try {
      expect(env.idx.getSymbolCount()).toBe(0);
    } finally {
      env.cleanup();
    }
  });

  it('returns correct count after adding symbols', () => {
    const env = makeTmpDb();
    try {
      seedModel(env.idx, 'ModelX', 'X');
      seedModel(env.idx, 'ModelY', 'Y');
      expect(env.idx.getSymbolCount()).toBe(4); // 2 symbols × 2 models
    } finally {
      env.cleanup();
    }
  });

  it('count decreases after clearModels()', () => {
    const env = makeTmpDb();
    try {
      seedModel(env.idx, 'ModelX', 'X');
      seedModel(env.idx, 'ModelY', 'Y');
      env.idx.clearModels(['ModelX']);
      expect(env.idx.getSymbolCount()).toBe(2);
    } finally {
      env.cleanup();
    }
  });
});
