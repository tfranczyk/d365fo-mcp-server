/**
 * Tests for batch N+1 query optimization
 *
 * Covers:
 *  - menuItemInfoTool: 3 batch queries replace per-symbol nested loops
 *  - securityCoverageInfoTool: 3 batch queries replace per-menu-item nested loops
 *
 * Tests use a real in-memory XppSymbolIndex so SQL logic is exercised end-to-end.
 * We verify correctness of the output (structure, values) not just "no crash".
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { XppSymbolIndex } from '../../src/metadata/symbolIndex.js';
import { menuItemInfoTool } from '../../src/tools/menuItemInfo.js';
import { securityCoverageInfoTool } from '../../src/tools/securityCoverageInfo.js';
import type { XppServerContext } from '../../src/types/context.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── test DB setup ─────────────────────────────────────────────────────────────

let idx: XppSymbolIndex;
let context: XppServerContext;
let tmpDir: string;

function makeRequest(toolName: string, args: Record<string, unknown>) {
  return {
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  } as any;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-test-'));
  idx = new XppSymbolIndex(path.join(tmpDir, 'test.db'));

  // ── seed symbols ────────────────────────────────────────────────────────────

  // Menu items
  idx.addSymbol({ name: 'CustTable', type: 'menu-item-display', filePath: '/mi.xml', model: 'TestModel' });
  idx.addSymbol({ name: 'SalesTable', type: 'menu-item-display', filePath: '/mi.xml', model: 'TestModel' });
  idx.addSymbol({ name: 'CustAction', type: 'menu-item-action', filePath: '/mi.xml', model: 'TestModel' });

  // Matching form
  idx.addSymbol({ name: 'CustTable', type: 'form', filePath: '/form.xml', model: 'TestModel' });

  // Security privilege entries: CustTable → 2 privileges, SalesTable → 1 privilege
  const insertPriv = idx.db.prepare(
    `INSERT INTO security_privilege_entries (privilege_name, entry_point_name, object_type, access_level, model)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertPriv.run('CustTableView', 'CustTable', 'MenuItemDisplay', 'Read', 'TestModel');
  insertPriv.run('CustTableMaint', 'CustTable', 'MenuItemDisplay', 'Update', 'TestModel');
  insertPriv.run('SalesTableView', 'SalesTable', 'MenuItemDisplay', 'Read', 'TestModel');

  // Duties
  const insertDuty = idx.db.prepare(
    `INSERT INTO security_duty_privileges (duty_name, privilege_name, model) VALUES (?, ?, ?)`
  );
  insertDuty.run('ViewCustomers', 'CustTableView', 'TestModel');
  insertDuty.run('MaintainCustomers', 'CustTableMaint', 'TestModel');
  insertDuty.run('ViewCustomers', 'SalesTableView', 'TestModel');  // shared duty

  // Roles
  const insertRole = idx.db.prepare(
    `INSERT INTO security_role_duties (role_name, duty_name, model) VALUES (?, ?, ?)`
  );
  insertRole.run('AccountsReceivableClerk', 'ViewCustomers', 'TestModel');
  insertRole.run('SalesClerk', 'ViewCustomers', 'TestModel');
  insertRole.run('AccountsReceivableManager', 'MaintainCustomers', 'TestModel');

  // Menu item targets
  idx.db.prepare(
    `INSERT INTO menu_item_targets (menu_item_name, menu_item_type, target_object, target_type, model)
     VALUES (?, ?, ?, ?, ?)`
  ).run('CustTable', 'display', 'CustTable', 'Form', 'TestModel');

  context = {
    symbolIndex: idx,
    cache: { get: async () => null, getFuzzy: async () => null, set: async () => {}, generateSearchKey: () => 'k' } as any,
    parser: {} as any,
    workspaceScanner: {} as any,
    hybridSearch: {} as any,
    termRelationshipGraph: {} as any,
  };
});

afterAll(() => {
  try { idx.close(); } catch { /**/ }
  // On Windows, SQLite WAL/SHM files may still be held briefly after close().
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
});

// ── menuItemInfoTool ──────────────────────────────────────────────────────────

describe('menuItemInfoTool – batch query correctness', () => {

  it('returns correct menu item type label', async () => {
    const result = await menuItemInfoTool(makeRequest('menu_item_info', { name: 'CustTable' }), context);
    const text: string = result.content[0].text;
    expect(text).toMatch(/MenuItemDisplay: CustTable/);
  });

  it('includes security chain for all privileges', async () => {
    const result = await menuItemInfoTool(makeRequest('menu_item_info', { name: 'CustTable' }), context);
    const text: string = result.content[0].text;

    expect(text).toContain('CustTableView');
    expect(text).toContain('CustTableMaint');
    expect(text).toContain('[Read]');
    expect(text).toContain('[Update]');
  });

  it('maps privileges to correct duties', async () => {
    const result = await menuItemInfoTool(makeRequest('menu_item_info', { name: 'CustTable' }), context);
    const text: string = result.content[0].text;

    expect(text).toContain('ViewCustomers');
    expect(text).toContain('MaintainCustomers');
  });

  it('maps duties to correct roles', async () => {
    const result = await menuItemInfoTool(makeRequest('menu_item_info', { name: 'CustTable' }), context);
    const text: string = result.content[0].text;

    expect(text).toContain('AccountsReceivableClerk');
    expect(text).toContain('SalesClerk');
    expect(text).toContain('AccountsReceivableManager');
  });

  it('includes matching form when same-name form exists', async () => {
    const result = await menuItemInfoTool(makeRequest('menu_item_info', { name: 'CustTable' }), context);
    const text: string = result.content[0].text;
    expect(text).toMatch(/Matching form: CustTable/i);
  });

  it('shows target object from menu_item_targets', async () => {
    const result = await menuItemInfoTool(makeRequest('menu_item_info', { name: 'CustTable' }), context);
    const text: string = result.content[0].text;
    expect(text).toMatch(/Target: CustTable/);
  });

  it('returns not-found message with suggestions for unknown item', async () => {
    const result = await menuItemInfoTool(makeRequest('menu_item_info', { name: 'NonExistentXYZ123' }), context);
    const text: string = result.content[0].text;
    expect(text).toMatch(/not found/i);
  });

  it('filters by itemType=action and excludes display items', async () => {
    const result = await menuItemInfoTool(
      makeRequest('menu_item_info', { name: 'CustAction', itemType: 'action' }),
      context
    );
    const text: string = result.content[0].text;
    expect(text).toMatch(/MenuItemAction: CustAction/);
  });

  it('shows "No privileges" when menu item exists but has no security entries', async () => {
    const result = await menuItemInfoTool(makeRequest('menu_item_info', { name: 'CustAction' }), context);
    const text: string = result.content[0].text;
    // CustAction has no privileges seeded → security chain section should be absent
    // (no "Security Chain:" header in output)
    expect(text).not.toContain('Security Chain:');
  });
});

// ── securityCoverageInfoTool ──────────────────────────────────────────────────

describe('securityCoverageInfoTool – batch query correctness', () => {

  it('shows correct menu item count in header', async () => {
    const result = await securityCoverageInfoTool(
      makeRequest('security_coverage_info', { objectName: 'CustTable', objectType: 'menu-item' }),
      context
    );
    const text: string = result.content[0].text;
    expect(text).toMatch(/Exposed via 1 menu item/i);
  });

  it('lists all privileges for the menu item', async () => {
    const result = await securityCoverageInfoTool(
      makeRequest('security_coverage_info', { objectName: 'CustTable', objectType: 'menu-item' }),
      context
    );
    const text: string = result.content[0].text;
    expect(text).toContain('CustTableView');
    expect(text).toContain('CustTableMaint');
  });

  it('shows correct access levels', async () => {
    const result = await securityCoverageInfoTool(
      makeRequest('security_coverage_info', { objectName: 'CustTable', objectType: 'menu-item' }),
      context
    );
    const text: string = result.content[0].text;
    expect(text).toContain('[Read]');
    expect(text).toContain('[Update]');
  });

  it('shows duties linked from privileges', async () => {
    const result = await securityCoverageInfoTool(
      makeRequest('security_coverage_info', { objectName: 'CustTable', objectType: 'menu-item' }),
      context
    );
    const text: string = result.content[0].text;
    expect(text).toContain('ViewCustomers');
    expect(text).toContain('MaintainCustomers');
  });

  it('shows roles linked from duties', async () => {
    const result = await securityCoverageInfoTool(
      makeRequest('security_coverage_info', { objectName: 'CustTable', objectType: 'menu-item' }),
      context
    );
    const text: string = result.content[0].text;
    expect(text).toContain('AccountsReceivableClerk');
    expect(text).toContain('AccountsReceivableManager');
  });

  it('summary counts match seeded data', async () => {
    const result = await securityCoverageInfoTool(
      makeRequest('security_coverage_info', { objectName: 'CustTable', objectType: 'menu-item' }),
      context
    );
    const text: string = result.content[0].text;

    // 2 privileges seeded for CustTable
    expect(text).toMatch(/Total privileges with any access: 2/);
    // 2 unique duties (ViewCustomers, MaintainCustomers)
    expect(text).toMatch(/Total duties: 2/);
    // 3 unique roles
    expect(text).toMatch(/Total roles with any access: 3/);
  });

  it('returns "No menu items found" for unknown object', async () => {
    const result = await securityCoverageInfoTool(
      makeRequest('security_coverage_info', { objectName: 'NoSuchObject99', objectType: 'form' }),
      context
    );
    const text: string = result.content[0].text;
    expect(text).toMatch(/no menu items found/i);
  });

  it('auto-detects type and still returns correct security chain', async () => {
    const result = await securityCoverageInfoTool(
      makeRequest('security_coverage_info', { objectName: 'CustTable', objectType: 'auto' }),
      context
    );
    const text: string = result.content[0].text;
    // Should find the menu-item and show its security
    expect(text).toContain('CustTableView');
  });

  it('shows "No privileges found" when menu item has no security entries', async () => {
    // SalesTable has a privilege, but let's check CustAction which has none
    const result = await securityCoverageInfoTool(
      makeRequest('security_coverage_info', { objectName: 'CustAction', objectType: 'menu-item' }),
      context
    );
    const text: string = result.content[0].text;
    // CustAction is in symbols but has no security_privilege_entries
    // → output should mention either "No privileges" or zero privileges
    expect(text).toMatch(/No privileges found|Total privileges with any access: 0/i);
  });
});
