/**
 * Tests for rateLimiter middleware – parseEnvInt validation
 *
 * express-rate-limit v7 does NOT expose windowMs/max as public properties on
 * the middleware function (only resetKey/getKey are public).  We therefore test
 * the behaviour functionally: create a minimal Express app with the limiter,
 * issue requests, and assert when 429 fires.
 *
 * For each scenario we:
 *  1. Set the env vars
 *  2. Force-reload the module (vi.resetModules) so parseEnvInt picks up new values
 *  3. Mount the fresh limiter on a fresh Express app
 *  4. Exercise it with supertest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';

// ── helpers ───────────────────────────────────────────────────────────────────

const RATE_KEYS = [
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
  'RATE_LIMIT_STRICT_MAX_REQUESTS',
  'RATE_LIMIT_AUTH_MAX_REQUESTS',
];

function saveEnv() {
  return Object.fromEntries(RATE_KEYS.map(k => [k, process.env[k]]));
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/**
 * Build a minimal Express app using a freshly-imported apiRateLimiter.
 * We must import AFTER setting env vars so parseEnvInt sees the new values.
 * Returns a supertest agent bound to the app.
 */
async function buildApp(extraEnv: Record<string, string | undefined> = {}) {
  // Apply env overrides
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  vi.resetModules();
  const { apiRateLimiter, strictRateLimiter, authRateLimiter } = await import(
    '../../src/middleware/rateLimiter.js'
  );

  const app = express();
  app.use(apiRateLimiter);
  app.get('/test', (_req, res) => res.json({ ok: true }));

  const strictApp = express();
  strictApp.use(strictRateLimiter);
  strictApp.get('/test', (_req, res) => res.json({ ok: true }));

  const authApp = express();
  authApp.use(authRateLimiter);
  authApp.post('/auth', (_req, res) => res.json({ ok: true }));

  return {
    api: supertest(app),
    strict: supertest(strictApp),
    auth: supertest(authApp),
  };
}

/** Send `count` GET /test requests and return all HTTP status codes. */
async function fireRequests(agent: supertest.Agent, count: number, method: 'get' | 'post' = 'get', path = '/test') {
  const codes: number[] = [];
  for (let i = 0; i < count; i++) {
    const res = await (method === 'get' ? agent.get(path) : agent.post(path));
    codes.push(res.status);
  }
  return codes;
}

// ── setup / teardown ───────────────────────────────────────────────────────────

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = saveEnv();
});

afterEach(() => {
  restoreEnv(savedEnv);
  vi.restoreAllMocks();
  vi.resetModules();
});

// ── defaults ───────────────────────────────────────────────────────────────────

describe('defaults – no env vars set', () => {
  it('allows up to 100 requests (default max) before rate limiting', async () => {
    const { api } = await buildApp({
      RATE_LIMIT_WINDOW_MS: undefined,
      RATE_LIMIT_MAX_REQUESTS: undefined,
    });

    // The first 3 requests should be OK (we don't want to send 100 in a test)
    const codes = await fireRequests(api, 3);
    expect(codes.every(c => c === 200)).toBe(true);
  });

  it('strictRateLimiter allows requests before its limit (default 20)', async () => {
    const { strict } = await buildApp({ RATE_LIMIT_STRICT_MAX_REQUESTS: undefined });
    const codes = await fireRequests(strict, 3);
    expect(codes.every(c => c === 200)).toBe(true);
  });

  it('authRateLimiter allows requests before its limit (default 5)', async () => {
    const { auth } = await buildApp({ RATE_LIMIT_AUTH_MAX_REQUESTS: undefined });
    const codes = await fireRequests(auth, 3, 'post', '/auth');
    expect(codes.every(c => c === 200)).toBe(true);
  });
});

// ── valid values applied correctly ────────────────────────────────────────────

describe('valid env var values – limits are respected', () => {
  it('applies RATE_LIMIT_MAX_REQUESTS=3: request 4 gets 429', async () => {
    const { api } = await buildApp({
      RATE_LIMIT_MAX_REQUESTS: '3',
      RATE_LIMIT_WINDOW_MS: '60000',
    });

    const codes = await fireRequests(api, 4);
    expect(codes.slice(0, 3).every(c => c === 200)).toBe(true);
    expect(codes[3]).toBe(429);
  });

  it('applies RATE_LIMIT_MAX_REQUESTS=1: request 2 gets 429', async () => {
    const { api } = await buildApp({
      RATE_LIMIT_MAX_REQUESTS: '1',
      RATE_LIMIT_WINDOW_MS: '60000',
    });

    const codes = await fireRequests(api, 2);
    expect(codes[0]).toBe(200);
    expect(codes[1]).toBe(429);
  });

  it('applies RATE_LIMIT_STRICT_MAX_REQUESTS=2: strict request 3 gets 429', async () => {
    const { strict } = await buildApp({
      RATE_LIMIT_STRICT_MAX_REQUESTS: '2',
      RATE_LIMIT_WINDOW_MS: '60000',
    });

    const codes = await fireRequests(strict, 3);
    expect(codes.slice(0, 2).every(c => c === 200)).toBe(true);
    expect(codes[2]).toBe(429);
  });
});

// ── non-numeric values fall back to defaults ──────────────────────────────────

describe('non-numeric env var values fall back to defaults', () => {
  it('RATE_LIMIT_MAX_REQUESTS="invalid" falls back to default 100 (no 429 at 3 requests)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = await buildApp({ RATE_LIMIT_MAX_REQUESTS: 'invalid' });

    // 3 requests must pass (default=100, well below limit)
    const codes = await fireRequests(api, 3);
    expect(codes.every(c => c === 200)).toBe(true);
    // parseEnvInt must have warned
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_MAX_REQUESTS'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid'));
    warnSpy.mockRestore();
  });

  it('RATE_LIMIT_WINDOW_MS="abc" falls back to default (no crash)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = await buildApp({ RATE_LIMIT_WINDOW_MS: 'abc' });

    const codes = await fireRequests(api, 2);
    expect(codes.every(c => c === 200)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_WINDOW_MS'));
    warnSpy.mockRestore();
  });

  it('RATE_LIMIT_MAX_REQUESTS="" (empty) falls back to default 100', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = await buildApp({ RATE_LIMIT_MAX_REQUESTS: '' });

    const codes = await fireRequests(api, 2);
    expect(codes.every(c => c === 200)).toBe(true);
    warnSpy.mockRestore();
  });
});

// ── out-of-range values fall back to defaults ─────────────────────────────────

describe('out-of-range env var values fall back to defaults', () => {
  it('RATE_LIMIT_MAX_REQUESTS=0 (below min 1) falls back to 100', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = await buildApp({ RATE_LIMIT_MAX_REQUESTS: '0' });

    // With default 100, first 3 pass easily
    const codes = await fireRequests(api, 3);
    expect(codes.every(c => c === 200)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_MAX_REQUESTS'));
    warnSpy.mockRestore();
  });

  it('RATE_LIMIT_MAX_REQUESTS=10001 (above max 10000) falls back to 100', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = await buildApp({ RATE_LIMIT_MAX_REQUESTS: '10001' });

    const codes = await fireRequests(api, 3);
    expect(codes.every(c => c === 200)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_MAX_REQUESTS'));
    warnSpy.mockRestore();
  });

  it('RATE_LIMIT_WINDOW_MS=9999 (below min 10000) falls back to 900000', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = await buildApp({ RATE_LIMIT_WINDOW_MS: '9999' });

    const codes = await fireRequests(api, 2);
    expect(codes.every(c => c === 200)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_WINDOW_MS'));
    warnSpy.mockRestore();
  });

  it('RATE_LIMIT_WINDOW_MS=86400001 (above max 86400000) falls back to 900000', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = await buildApp({ RATE_LIMIT_WINDOW_MS: '86400001' });

    const codes = await fireRequests(api, 2);
    expect(codes.every(c => c === 200)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_WINDOW_MS'));
    warnSpy.mockRestore();
  });

  it('RATE_LIMIT_AUTH_MAX_REQUESTS=101 (above max 100) falls back to 5', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { auth } = await buildApp({ RATE_LIMIT_AUTH_MAX_REQUESTS: '101' });

    // With default 5, 3 auth requests still pass
    const codes = await fireRequests(auth, 3, 'post', '/auth');
    expect(codes.every(c => c === 200)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_AUTH_MAX_REQUESTS'));
    warnSpy.mockRestore();
  });

  it('RATE_LIMIT_STRICT_MAX_REQUESTS=1001 (above max 1000) falls back to 20', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { strict } = await buildApp({ RATE_LIMIT_STRICT_MAX_REQUESTS: '1001' });

    const codes = await fireRequests(strict, 3);
    expect(codes.every(c => c === 200)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_STRICT_MAX_REQUESTS'));
    warnSpy.mockRestore();
  });
});

// ── negative values fall back to defaults ─────────────────────────────────────

describe('negative env var values fall back to defaults', () => {
  it('RATE_LIMIT_MAX_REQUESTS=-100 falls back to 100', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = await buildApp({ RATE_LIMIT_MAX_REQUESTS: '-100' });

    const codes = await fireRequests(api, 2);
    expect(codes.every(c => c === 200)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_MAX_REQUESTS'));
    warnSpy.mockRestore();
  });

  it('RATE_LIMIT_WINDOW_MS=-1 falls back to 900000', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = await buildApp({ RATE_LIMIT_WINDOW_MS: '-1' });

    const codes = await fireRequests(api, 2);
    expect(codes.every(c => c === 200)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_WINDOW_MS'));
    warnSpy.mockRestore();
  });
});

// ── 429 response body format ───────────────────────────────────────────────────

describe('429 response has correct body', () => {
  it('returns JSON with error and message fields when rate limited', async () => {
    const { api } = await buildApp({
      RATE_LIMIT_MAX_REQUESTS: '1',
      RATE_LIMIT_WINDOW_MS: '60000',
    });

    await api.get('/test').expect(200); // use up the limit
    const res = await api.get('/test').expect(429);

    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.error).toBe('string');
  });

  it('returns RateLimit-* standard headers', async () => {
    const { api } = await buildApp({
      RATE_LIMIT_MAX_REQUESTS: '2',
      RATE_LIMIT_WINDOW_MS: '60000',
    });

    const res = await api.get('/test').expect(200);
    // express-rate-limit v7 uses 'ratelimit-limit' (lowercase) in standardHeaders mode
    const limitHeader = res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit'];
    expect(limitHeader).toBeDefined();
  });
});

// ── health endpoint skip ──────────────────────────────────────────────────────

describe('health endpoint is exempt from rate limiting', () => {
  it('/health is not rate limited even when API limiter would normally block', async () => {
    const { api } = await buildApp({
      RATE_LIMIT_MAX_REQUESTS: '1',
      RATE_LIMIT_WINDOW_MS: '60000',
    });

    // Build app with health endpoint
    vi.resetModules();
    const { apiRateLimiter } = await import('../../src/middleware/rateLimiter.js');
    const app = express();
    app.use(apiRateLimiter);
    app.get('/test', (_req, res) => res.json({ ok: true }));
    app.get('/health', (_req, res) => res.json({ status: 'healthy' }));
    const agent = supertest(app);

    await agent.get('/test').expect(200); // use up the 1-request limit
    await agent.get('/test').expect(429); // rate limited

    // /health must still work
    const healthRes = await agent.get('/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('healthy');
  });
});
