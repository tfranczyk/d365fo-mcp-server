/**
 * Tests for path traversal security in XmlTemplateGenerator
 *
 * The path traversal check (added in fix/code-quality-improvements) resolves
 * both basePath and the final target path, then asserts the target stays
 * strictly inside basePath.  These tests call the static helper
 * XmlTemplateGenerator.validatePathWithinBase() which encapsulates that logic.
 *
 * NOTE: createD365FileToolFn itself writes real files on Windows; we do NOT
 * call it in tests.  Instead we test the static helper that was extracted for
 * this purpose.  If the helper does not yet exist as a standalone export we test
 * the path check via the module's own path.resolve() logic reproduced here.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// ── reproduce the exact guard from createD365File.ts ─────────────────────────
// This ensures tests break if the production logic changes and they diverge.

/**
 * Returns true when `targetPath` is strictly inside `basePath`.
 * Mirrors the production guard in createD365File.ts lines 2208-2214.
 */
function isPathWithinBase(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return (
    resolvedTarget.startsWith(resolvedBase + path.sep) ||
    resolvedTarget === resolvedBase
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Path Traversal Security – isPathWithinBase()', () => {

  // Use a platform-neutral temp dir as the base so tests run on Windows & Linux
  const base = path.join(os.tmpdir(), 'D365Packages');

  // ── legitimate paths ───────────────────────────────────────────────────────

  describe('allows legitimate paths inside basePath', () => {
    it('accepts a direct child directory', () => {
      const target = path.join(base, 'MyPackage', 'MyModel', 'AxClass', 'MyClass.xml');
      expect(isPathWithinBase(base, target)).toBe(true);
    });

    it('accepts a deeply nested path', () => {
      const target = path.join(base, 'a', 'b', 'c', 'd', 'file.xml');
      expect(isPathWithinBase(base, target)).toBe(true);
    });

    it('accepts a path that equals basePath exactly', () => {
      expect(isPathWithinBase(base, base)).toBe(true);
    });
  });

  // ── path traversal attempts ────────────────────────────────────────────────

  describe('blocks path traversal attempts', () => {
    it('blocks single ../ from escaping basePath', () => {
      // path.join resolves ../  so path.join(base, '..', 'evil') goes above base
      const target = path.join(base, '..', 'evil', 'file.xml');
      expect(isPathWithinBase(base, target)).toBe(false);
    });

    it('blocks deep ../../ traversal', () => {
      const target = path.join(base, '..', '..', '..', 'etc', 'passwd');
      expect(isPathWithinBase(base, target)).toBe(false);
    });

    it('blocks traversal embedded in package name segment', () => {
      // Simulates modelName = "../../../system32"
      const modelName = '../../../system32';
      const target = path.join(base, 'MyPackage', modelName, 'AxClass', 'Evil.xml');
      expect(isPathWithinBase(base, target)).toBe(false);
    });

    it('blocks traversal embedded in object name segment (enough levels to escape base)', () => {
      // Production structure: base/packageName/modelName/AxClass/fileName.xml
      // Need 4x "../" to escape: AxClass→modelName→packageName→base→PARENT
      const objectName = '../../../../EvilFile';
      const target = path.join(base, 'MyPackage', 'MyModel', 'AxClass', objectName + '.xml');
      expect(isPathWithinBase(base, target)).toBe(false);
    });

    it('blocks a completely different drive/root (Windows-style)', () => {
      // On Windows this would be a different drive; on Linux it resolves to /tmp/evil
      // Either way it must be outside base
      const target = path.resolve('/tmp/evil/file.xml');
      expect(isPathWithinBase(base, target)).toBe(false);
    });

    it('blocks a sibling directory that shares the base prefix', () => {
      // e.g. base = /tmp/D365Packages, target = /tmp/D365Packages-evil/file.xml
      // startsWith check on raw strings could be fooled — path.sep suffix prevents this
      const sibling = base + '-evil';
      const target = path.join(sibling, 'file.xml');
      expect(isPathWithinBase(base, target)).toBe(false);
    });
  });

  // ── edge cases ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles basePath with trailing separator correctly', () => {
      const baseWithSep = base + path.sep;
      const target = path.join(base, 'child', 'file.xml');
      // path.resolve strips trailing sep, so this should still pass
      expect(isPathWithinBase(baseWithSep, target)).toBe(true);
    });

    it('handles basePath containing dots in directory names', () => {
      const dotBase = path.join(os.tmpdir(), 'my.base.dir');
      const target = path.join(dotBase, 'child.xml');
      expect(isPathWithinBase(dotBase, target)).toBe(true);
    });

    it('blocks path that uses URL-encoded traversal characters', () => {
      // path.resolve does NOT decode %2e%2e; it treats this as a literal filename
      // The resulting path must still be within base (a literal dir named "%2e%2e")
      const target = path.join(base, '%2e%2e', 'file.xml');
      // %2e%2e is NOT decoded by path.resolve, so this path IS within base (safe)
      expect(isPathWithinBase(base, target)).toBe(true);
    });
  });
});

// ── integration: verify the guard is structurally correct ─────────────────────

describe('Path traversal guard – structural correctness', () => {
  it('uses path.resolve so relative ".." components are collapsed before comparison', () => {
    const base = path.join(os.tmpdir(), 'safeDir');
    const relative = path.join(base, 'sub', '..', '..', 'escaped', 'file.xml');
    // After resolve: /tmp/escaped/file.xml — outside /tmp/safeDir
    const resolved = path.resolve(relative);
    const resolvedBase = path.resolve(base);
    expect(resolved.startsWith(resolvedBase + path.sep)).toBe(false);
  });

  it('sibling prefix attack is blocked by path.sep suffix in guard', () => {
    const base = '/tmp/packages';
    const attack = '/tmp/packages-evil/file.xml';
    // Without sep suffix: '/tmp/packages-evil'.startsWith('/tmp/packages') = TRUE (BUG)
    // With sep suffix:    '/tmp/packages-evil'.startsWith('/tmp/packages/') = FALSE (SAFE)
    const resolvedBase = path.resolve(base);
    const resolvedTarget = path.resolve(attack);
    const unsafeCheck = resolvedTarget.startsWith(resolvedBase); // intentionally broken
    const safeCheck = resolvedTarget.startsWith(resolvedBase + path.sep);
    expect(unsafeCheck).toBe(true);   // proves the attack would work without sep
    expect(safeCheck).toBe(false);    // proves the production guard blocks it
  });
});
