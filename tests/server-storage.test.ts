import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalStorage, privatePhotoPath } from '../lib/local-storage';
import { dataDirectory } from '../lib/storage-config';

let directory: string;
beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), 'cm-server-test-')); });
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('private server storage', () => {
  it('rolls back the entire metadata transaction on a failed statement', async () => {
    const storage = createLocalStorage(path.join(directory, 'transaction'));
    try {
      await storage.database.prepare('CREATE TABLE items (id TEXT PRIMARY KEY)').run();
      await expect(storage.database.batch([
        storage.database.prepare('INSERT INTO items VALUES (?)').bind('same'),
        storage.database.prepare('INSERT INTO items VALUES (?)').bind('same'),
      ])).rejects.toThrow();
      expect((await storage.database.prepare('SELECT * FROM items').all()).results).toHaveLength(0);
    } finally { storage.close(); }
  });

  it('keeps generated image paths private and refuses overwrite or traversal', async () => {
    const storage = createLocalStorage(path.join(directory, 'photo-paths'));
    const key = `reports/${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`;
    try {
      await storage.photos.put(key, Uint8Array.of(1, 2, 3).buffer);
      await expect(storage.photos.put(key, Uint8Array.of(9).buffer)).rejects.toThrow();
      expect(await readFile(privatePhotoPath(storage.directory, key))).toEqual(Buffer.from([1, 2, 3]));
      for (const invalid of ['../reports.sqlite', '/etc/passwd', 'reports/../photos.jpg', 'reports/a/b.jpg', key.replaceAll('/', '\\')]) {
        expect(() => privatePhotoPath(storage.directory, invalid)).toThrow('Invalid photo storage key');
      }
    } finally { storage.close(); }
  });

  it('requires a private local disk folder outside the production application', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CM_DATA_DIR', '');
    expect(dataDirectory).toThrow('CM_DATA_DIR must point');
    for (const candidate of ['relative-folder', '\\\\fileserver\\share', path.join(process.cwd(), 'public', 'uploads'), process.cwd()]) {
      vi.stubEnv('CM_DATA_DIR', candidate);
      expect(dataDirectory).toThrow();
    }
    vi.stubEnv('CM_DATA_DIR', directory);
    expect(dataDirectory()).toBe(path.resolve(directory));
  });

});
