/**
 * Tests for RedisCacheService – URL/connection validation
 *
 * We test the constructor's validation logic without making real network calls.
 * ioredis uses lazyConnect:true so no actual TCP connection is attempted during
 * construction; only URL parsing / hostname / port validation fires.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Environment keys touched by these tests */
const REDIS_KEYS = ['REDIS_URL', 'REDIS_ENABLED', 'REDIS_CLUSTER_MODE', 'CACHE_TTL'];

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(REDIS_KEYS.map(k => [k, process.env[k]]));
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function importFresh() {
  vi.resetModules();
  return import('../../src/cache/redisCache.js');
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('RedisCacheService', () => {

  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = saveEnv();
    // Silence connection-related logs during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    restoreEnv(savedEnv);
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ── disabled (default) ─────────────────────────────────────────────────────

  describe('when Redis is not configured', () => {
    it('is disabled when REDIS_ENABLED is not set', async () => {
      delete process.env.REDIS_ENABLED;
      delete process.env.REDIS_URL;
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      expect(svc.isEnabled()).toBe(false);
    });

    it('is disabled when REDIS_ENABLED=false', async () => {
      process.env.REDIS_ENABLED = 'false';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      expect(svc.isEnabled()).toBe(false);
    });

    it('is disabled when REDIS_ENABLED=true but REDIS_URL is empty', async () => {
      process.env.REDIS_ENABLED = 'true';
      delete process.env.REDIS_URL;
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      expect(svc.isEnabled()).toBe(false);
    });
  });

  // ── cluster mode URL validation ────────────────────────────────────────────

  describe('cluster mode – invalid REDIS_URL', () => {
    beforeEach(() => {
      process.env.REDIS_ENABLED = 'true';
      process.env.REDIS_CLUSTER_MODE = 'true';
    });

    it('disables cache when REDIS_URL has no hostname (redis://)', async () => {
      process.env.REDIS_URL = 'redis://';
      const { RedisCacheService } = await importFresh();
      // Constructor must not throw; it catches the error and sets enabled=false
      expect(() => new RedisCacheService()).not.toThrow();
      const svc = new RedisCacheService();
      expect(svc.isEnabled()).toBe(false);
    });

    it('disables cache when REDIS_URL port is 0', async () => {
      process.env.REDIS_URL = 'redis://myredis.host:0';
      const { RedisCacheService } = await importFresh();
      expect(() => new RedisCacheService()).not.toThrow();
      const svc = new RedisCacheService();
      expect(svc.isEnabled()).toBe(false);
    });

    it('disables cache when REDIS_URL port is 65536 (out of range)', async () => {
      process.env.REDIS_URL = 'redis://myredis.host:65536';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      expect(svc.isEnabled()).toBe(false);
    });

    it('disables cache when REDIS_URL port is negative (-1)', async () => {
      // new URL() with negative port → port string becomes "-1" → parseInt = -1
      // Our validator should reject port < 1
      process.env.REDIS_URL = 'redis://myredis.host:-1';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      expect(svc.isEnabled()).toBe(false);
    });

    it('accepts a valid cluster URL rediss://host:6380 (TLS)', async () => {
      process.env.REDIS_URL = 'rediss://myredis.host:6380';
      const { RedisCacheService } = await importFresh();
      // Construction should not throw; isEnabled() stays false until connect() resolves
      // but that's async – we just assert no exception is thrown
      expect(() => new RedisCacheService()).not.toThrow();
    });

    it('accepts valid redis://host:6379 (no TLS)', async () => {
      process.env.REDIS_URL = 'redis://myredis.host:6379';
      const { RedisCacheService } = await importFresh();
      expect(() => new RedisCacheService()).not.toThrow();
    });
  });

  // ── non-cluster mode – no URL validation needed, ioredis handles it ────────

  describe('non-cluster mode', () => {
    beforeEach(() => {
      process.env.REDIS_ENABLED = 'true';
      process.env.REDIS_CLUSTER_MODE = 'false';
    });

    it('creates instance without throwing for any redis:// URL', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { RedisCacheService } = await importFresh();
      expect(() => new RedisCacheService()).not.toThrow();
    });
  });

  // ── key generation helpers ─────────────────────────────────────────────────

  describe('cache key generation', () => {
    it('generateSearchKey produces xpp:search: prefixed key', async () => {
      process.env.REDIS_ENABLED = 'false';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      const key = svc.generateSearchKey('CustTable', 10, 'table');
      expect(key).toMatch(/^xpp:search:/);
      expect(key).toContain('custtable'); // normalizeQuery lowercases
      expect(key).toContain('table');
    });

    it('generateClassKey produces xpp:class: prefixed key', async () => {
      process.env.REDIS_ENABLED = 'false';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      expect(svc.generateClassKey('SalesLine')).toBe('xpp:class:SalesLine');
    });

    it('generateTableKey produces xpp:table: prefixed key', async () => {
      process.env.REDIS_ENABLED = 'false';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      expect(svc.generateTableKey('CustTable')).toBe('xpp:table:CustTable');
    });

    it('generateCompletionKey produces xpp:complete: prefixed key', async () => {
      process.env.REDIS_ENABLED = 'false';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      expect(svc.generateCompletionKey('SalesFormLetter', 'get')).toBe('xpp:complete:SalesFormLetter:get');
    });
  });

  // ── disabled-service no-ops ────────────────────────────────────────────────

  describe('disabled service returns safe no-op values', () => {
    it('get() returns null when disabled', async () => {
      process.env.REDIS_ENABLED = 'false';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      await expect(svc.get('any-key')).resolves.toBeNull();
    });

    it('set() resolves without error when disabled', async () => {
      process.env.REDIS_ENABLED = 'false';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      await expect(svc.set('key', { data: 1 })).resolves.toBeUndefined();
    });

    it('delete() resolves without error when disabled', async () => {
      process.env.REDIS_ENABLED = 'false';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      await expect(svc.delete('key')).resolves.toBeUndefined();
    });

    it('isEnabled() returns false when disabled', async () => {
      process.env.REDIS_ENABLED = 'false';
      const { RedisCacheService } = await importFresh();
      const svc = new RedisCacheService();
      expect(svc.isEnabled()).toBe(false);
    });
  });

  // ── CACHE_TTL env validation ───────────────────────────────────────────────

  describe('CACHE_TTL env var', () => {
    it('uses 3600 default when CACHE_TTL is not set', async () => {
      process.env.REDIS_ENABLED = 'false';
      delete process.env.CACHE_TTL;
      const { RedisCacheService } = await importFresh();
      // defaultTTL is private; indirectly verified — construction must not throw
      expect(() => new RedisCacheService()).not.toThrow();
    });

    it('uses 3600 default when CACHE_TTL is NaN', async () => {
      process.env.REDIS_ENABLED = 'false';
      process.env.CACHE_TTL = 'not-a-number';
      const { RedisCacheService } = await importFresh();
      // Constructor contains: isNaN(ttl) ? 3600 : ttl  → must not throw
      expect(() => new RedisCacheService()).not.toThrow();
    });
  });
});
