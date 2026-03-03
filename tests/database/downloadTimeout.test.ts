/**
 * Tests for database/download.ts – AbortController timeout handling
 *
 * We mock @azure/storage-blob so no real HTTP calls are made.
 * Each test controls whether the download resolves instantly, hangs, or errors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// ── Azure SDK mock ────────────────────────────────────────────────────────────

let mockDownloadToFile: ReturnType<typeof vi.fn>;
let mockExists: ReturnType<typeof vi.fn>;
let mockGetProperties: ReturnType<typeof vi.fn>;

vi.mock('@azure/storage-blob', () => {
  return {
    BlobServiceClient: {
      fromConnectionString: vi.fn(() => ({
        getContainerClient: vi.fn(() => ({
          getBlobClient: vi.fn(() => ({
            exists: mockExists,
            getProperties: mockGetProperties,
            downloadToFile: mockDownloadToFile,
          })),
        })),
      })),
    },
  };
});

// ── helpers ───────────────────────────────────────────────────────────────────

/** Creates a temp directory and returns paths for the DB and its tmp file. */
async function makeTempPaths() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-test-'));
  const localPath = path.join(dir, 'xpp-metadata.db');
  const tmpPath = `${localPath}.tmp`;
  return { dir, localPath, tmpPath };
}

/**
 * Create a minimal valid SQLite database using better-sqlite3.
 * This is synchronous (better-sqlite3 is a synchronous API) and produces
 * a real database file that passes SQLite's quick_check pragma.
 */
function writeFakeSqlite(filePath: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3').default;
  const db = new Database(filePath);
  db.exec('CREATE TABLE _placeholder (id INTEGER PRIMARY KEY)');
  db.close();
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('downloadDatabaseFromBlob – AbortController timeout', () => {

  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING };
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net';

    // Reset mocks
    mockExists = vi.fn().mockResolvedValue(true);
    mockGetProperties = vi.fn().mockResolvedValue({ contentLength: 1024 });
    mockDownloadToFile = vi.fn();

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ── successful download ────────────────────────────────────────────────────

  it('downloads, validates and renames file on success', async () => {
    const { localPath, tmpPath } = await makeTempPaths();

    mockDownloadToFile = vi.fn().mockImplementation((dest: string) => {
      // Simulate writing a valid DB to the tmp path
      writeFakeSqlite(dest);
    });

    vi.resetModules();
    const { downloadDatabaseFromBlob } = await import('../../src/database/download.js');

    const result = await downloadDatabaseFromBlob({
      localPath,
      timeoutMs: 5000,
      maxRetries: 1,
    });

    expect(result).toBe(localPath);

    // Tmp file should be gone (renamed to final)
    await expect(fs.access(tmpPath)).rejects.toThrow();
  });

  // ── timeout via AbortController ───────────────────────────────────────────

  it('throws "Download timeout" error when download hangs past timeoutMs', async () => {
    const { localPath } = await makeTempPaths();

    mockDownloadToFile = vi.fn().mockImplementation(
      (_dest: string, _offset: unknown, _length: unknown, opts: { abortSignal?: AbortSignal }) => {
        return new Promise<void>((_, reject) => {
          // Listen for abort signal — mirrors what Azure SDK does
          opts?.abortSignal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            (err as any).name = 'AbortError';
            reject(err);
          });
          // Never resolve on its own (simulates a hung download)
        });
      }
    );

    vi.resetModules();
    const { downloadDatabaseFromBlob } = await import('../../src/database/download.js');

    await expect(
      downloadDatabaseFromBlob({
        localPath,
        timeoutMs: 50,   // very short timeout so the test runs fast
        maxRetries: 1,
      })
    ).rejects.toThrow(/timeout/i);
  }, 10_000);

  // ── abort signal is passed to SDK ─────────────────────────────────────────

  it('passes an AbortSignal to downloadToFile', async () => {
    const { localPath } = await makeTempPaths();
    let capturedSignal: AbortSignal | undefined;

    mockDownloadToFile = vi.fn().mockImplementation(
      (dest: string, _offset: unknown, _length: unknown, opts: any) => {
        capturedSignal = opts?.abortSignal;
        writeFakeSqlite(dest);
      }
    );

    vi.resetModules();
    const { downloadDatabaseFromBlob } = await import('../../src/database/download.js');

    await downloadDatabaseFromBlob({ localPath, timeoutMs: 5000, maxRetries: 1 });

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    // Signal should NOT have been aborted yet (download finished in time)
    expect(capturedSignal?.aborted).toBe(false);
  });

  // ── clearTimeout cleanup ──────────────────────────────────────────────────

  it('clearTimeout is called: timer does not fire after successful download', async () => {
    // Spy on clearTimeout to confirm the AbortController timer is cancelled
    // after a successful download.  We do NOT use fake timers here because
    // fake-timer interaction with real async I/O is fragile; instead we
    // directly assert that clearTimeout was called.
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const { localPath } = await makeTempPaths();

    mockDownloadToFile = vi.fn().mockImplementation((dest: string) => {
      writeFakeSqlite(dest);
    });

    vi.resetModules();
    const { downloadDatabaseFromBlob } = await import('../../src/database/download.js');

    const result = await downloadDatabaseFromBlob({ localPath, timeoutMs: 5000, maxRetries: 1 });
    expect(result).toBe(localPath);

    // clearTimeout must have been called at least once (main timeout + labels timeout)
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  // ── blob not found ────────────────────────────────────────────────────────

  it('throws when blob does not exist', async () => {
    const { localPath } = await makeTempPaths();
    mockExists = vi.fn().mockResolvedValue(false);

    vi.resetModules();
    const { downloadDatabaseFromBlob } = await import('../../src/database/download.js');

    await expect(
      downloadDatabaseFromBlob({ localPath, timeoutMs: 5000, maxRetries: 1 })
    ).rejects.toThrow(/not found/i);
  });

  // ── corrupted DB rejected ─────────────────────────────────────────────────

  it('throws when downloaded file fails SQLite integrity check', async () => {
    const { localPath } = await makeTempPaths();

    mockDownloadToFile = vi.fn().mockImplementation(async (dest: string) => {
      // Write garbage — not a valid SQLite file
      await fs.writeFile(dest, 'this is not sqlite');
    });

    vi.resetModules();
    const { downloadDatabaseFromBlob } = await import('../../src/database/download.js');

    await expect(
      downloadDatabaseFromBlob({ localPath, timeoutMs: 5000, maxRetries: 1 })
    ).rejects.toThrow(/corrupted|integrity/i);
  });

  // ── tmp file cleanup on error ─────────────────────────────────────────────

  it('removes the .tmp file when download throws a non-abort error', async () => {
    const { localPath, tmpPath } = await makeTempPaths();

    mockDownloadToFile = vi.fn().mockRejectedValue(new Error('Network error'));

    vi.resetModules();
    const { downloadDatabaseFromBlob } = await import('../../src/database/download.js');

    await expect(
      downloadDatabaseFromBlob({ localPath, timeoutMs: 5000, maxRetries: 1 })
    ).rejects.toThrow();

    // Tmp file should be cleaned up
    await expect(fs.access(tmpPath)).rejects.toThrow();
  });

  // ── missing connection string ──────────────────────────────────────────────

  it('throws immediately when connection string is missing', async () => {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    vi.resetModules();
    const { downloadDatabaseFromBlob } = await import('../../src/database/download.js');

    await expect(
      downloadDatabaseFromBlob({ localPath: '/tmp/test.db' })
    ).rejects.toThrow(/connection string/i);
  });
});

// ── checkDatabaseVersion ───────────────────────────────────────────────────────

describe('checkDatabaseVersion', () => {
  beforeEach(() => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net';
    mockExists = vi.fn().mockResolvedValue(true);
    mockGetProperties = vi.fn().mockResolvedValue({ contentLength: 1024, lastModified: new Date('2025-01-01') });
    mockDownloadToFile = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns needsUpdate=true when local file does not exist', async () => {
    vi.resetModules();
    const { checkDatabaseVersion } = await import('../../src/database/download.js');
    const result = await checkDatabaseVersion('/nonexistent/path/db.db');
    expect(result.needsUpdate).toBe(true);
  });

  it('returns needsUpdate=false when no connection string is configured', async () => {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    vi.resetModules();
    const { checkDatabaseVersion } = await import('../../src/database/download.js');
    const result = await checkDatabaseVersion('/any/path.db');
    expect(result.needsUpdate).toBe(false);
  });

  it('returns needsUpdate=true when remote is newer than local', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'version-test-'));
    const localPath = path.join(tmpDir, 'test.db');
    // Write local file with an old mtime
    await fs.writeFile(localPath, 'x');
    await fs.utimes(localPath, new Date('2024-01-01'), new Date('2024-01-01'));

    mockGetProperties = vi.fn().mockResolvedValue({ lastModified: new Date('2025-06-01') });

    vi.resetModules();
    const { checkDatabaseVersion } = await import('../../src/database/download.js');
    const result = await checkDatabaseVersion(localPath);
    expect(result.needsUpdate).toBe(true);
    expect(result.localModified).toBeInstanceOf(Date);
    expect(result.remoteModified).toBeInstanceOf(Date);
  });

  it('returns needsUpdate=false when local is newer than remote', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'version-test2-'));
    const localPath = path.join(tmpDir, 'test.db');
    await fs.writeFile(localPath, 'x');
    await fs.utimes(localPath, new Date('2026-01-01'), new Date('2026-01-01'));

    mockGetProperties = vi.fn().mockResolvedValue({ lastModified: new Date('2025-01-01') });

    vi.resetModules();
    const { checkDatabaseVersion } = await import('../../src/database/download.js');
    const result = await checkDatabaseVersion(localPath);
    expect(result.needsUpdate).toBe(false);
  });
});
