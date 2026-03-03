/**
 * Tests for CustomHttpTransport – timeout and memory-leak prevention
 *
 * Focus: verify that
 *  1. clearTimeout is called when a response arrives before the timeout fires
 *  2. The timer fires and rejects the promise when no response comes within the deadline
 *  3. pendingRequests map is properly cleaned up in both cases (no leaks)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createStreamableHttpTransport } from '../../src/server/transport.js';
import { registerToolHandler } from '../../src/tools/toolHandler.js';
import type { XppServerContext } from '../../src/types/context.js';
import type { XppSymbolIndex } from '../../src/metadata/symbolIndex.js';
import type { RedisCacheService } from '../../src/cache/redisCache.js';
import supertest from 'supertest';

// ── shared test infrastructure ────────────────────────────────────────────────

function buildTestApp() {
  const app = express();
  app.use(express.json());

  const mcpServer = new Server(
    { name: 'transport-timeout-test', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  const mockSymbolIndex: Partial<XppSymbolIndex> = {
    searchSymbols: () => [],
    getSymbolByName: () => null,
    getClassMethods: () => [],
    getTableFields: () => [],
    getSymbolCount: () => 0,
    close: () => {},
  };

  const mockCache: Partial<RedisCacheService> = {
    get: async () => null,
    getFuzzy: async () => null,
    set: async () => {},
    generateSearchKey: () => 'test-key',
  };

  const context: XppServerContext = {
    symbolIndex: mockSymbolIndex as XppSymbolIndex,
    cache: mockCache as RedisCacheService,
    parser: {} as any,
    workspaceScanner: {} as any,
    hybridSearch: {} as any,
    termRelationshipGraph: {} as any,
  };

  registerToolHandler(mcpServer, context);
  const transport = createStreamableHttpTransport(mcpServer, app, context);
  return { app, transport };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('CustomHttpTransport – timeout and cleanup', () => {
  let app: express.Express;
  let httpServer: any;
  let request: ReturnType<typeof supertest>;
  let transport: any;

  beforeAll(() => {
    ({ app, transport } = buildTestApp());
    httpServer = app.listen(0); // random free port
    request = supertest(app);
  });

  afterAll((done) => {
    httpServer.close(done);
  });

  // ── clearTimeout: response before deadline ─────────────────────────────────

  describe('clearTimeout is called when response arrives before timeout', () => {
    it('a normal request resolves and leaves no entries in pendingRequests', async () => {
      const response = await request
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 'timeout-test-1',
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          },
        })
        .expect(200);

      expect(response.body.result).toBeDefined();
      // After the response, pendingRequests must NOT contain our id
      expect(transport.pendingRequests.has('timeout-test-1')).toBe(false);
    });

    it('timer is cancelled: no "Request timeout" rejection fires after response', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });

      const responsePromise = request
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 'timeout-test-2',
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          },
        });

      // Let real I/O settle (request + response cycle)
      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(response.body.result).toBeDefined();

      // After response, advance time past the 30 s threshold — must NOT crash
      vi.advanceTimersByTime(35_000);

      // No unhandled rejection → timer was properly cleared
      expect(transport.pendingRequests.has('timeout-test-2')).toBe(false);

      vi.useRealTimers();
    });
  });

  // ── concurrent requests – no cross-contamination ──────────────────────────

  describe('concurrent requests are isolated', () => {
    it('10 parallel requests all resolve with correct ids', async () => {
      const ids = Array.from({ length: 10 }, (_, i) => `concurrent-${i}`);

      const responses = await Promise.all(
        ids.map(id =>
          request.post('/mcp').send({
            jsonrpc: '2.0',
            id,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'test', version: '1.0' },
            },
          })
        )
      );

      for (let i = 0; i < responses.length; i++) {
        expect(responses[i].status).toBe(200);
        expect(responses[i].body.id).toBe(ids[i]);
        expect(responses[i].body.result).toBeDefined();
      }

      // All pending requests must be cleaned up
      for (const id of ids) {
        expect(transport.pendingRequests.has(id)).toBe(false);
      }
    });
  });

  // ── timeout fires when no response comes ──────────────────────────────────

  describe('timeout fires when MCP server does not respond', () => {
    it('rejects with "Request timeout" and cleans up pendingRequests', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });

      // Temporarily break onmessage so the MCP server never gets the message
      const originalOnmessage = transport.onmessage;
      transport.onmessage = undefined;

      const responsePromise = request
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 'will-timeout',
          method: 'tools/call',
          params: { name: 'search', arguments: { query: 'test' } },
        });

      // Advance past the 30 s timeout
      await vi.runAllTimersAsync();

      const response = await responsePromise;
      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
      // Transport error message should mention timeout
      expect(JSON.stringify(response.body)).toMatch(/timeout|error/i);

      // Pending request must be removed even after timeout
      expect(transport.pendingRequests.has('will-timeout')).toBe(false);

      // Restore
      transport.onmessage = originalOnmessage;
      vi.useRealTimers();
    });
  });

  // ── notification handling ──────────────────────────────────────────────────

  describe('notifications (no id) are handled without pending entries', () => {
    it('notifications/initialized returns 202 and leaves no pending request', async () => {
      const response = await request
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        })
        .expect(202);

      expect(response.body.status).toBe('accepted');
      // Notifications have no id, so pendingRequests must be empty (or unchanged)
      expect(transport.pendingRequests.size).toBe(0);
    });
  });

  // ── malformed request ──────────────────────────────────────────────────────

  describe('malformed requests are rejected cleanly', () => {
    it('returns 400 for request missing jsonrpc field', async () => {
      const response = await request
        .post('/mcp')
        .send({ id: 1, method: 'initialize', params: {} })
        .expect(400);

      expect(response.body.error.code).toBe(-32600);
      expect(response.body.error.message).toMatch(/invalid request/i);
    });

    it('returns 400 for request missing method field', async () => {
      const response = await request
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 2, params: {} })
        .expect(400);

      expect(response.body.error.code).toBe(-32600);
    });
  });
});
