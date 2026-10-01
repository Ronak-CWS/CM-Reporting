import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalStorage, privatePhotoPath } from '../lib/local-storage';
import { dataDirectory } from '../lib/storage-config';
import { getLocationCatalogue } from '../lib/location-catalogue-store';
import { accessFailure } from '../lib/request-access';

let directory: string;
beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), 'cm-server-test-')); });
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('private server storage', () => {
  it('runs the real startup configuration check without starting a server', async () => {
    const result = await promisify(execFile)(process.execPath, ['scripts/check-server.mjs'], {
      env: { ...process.env, NODE_ENV: 'production', CM_AUTH_MODE: 'proxy', CM_DATA_DIR: path.join(directory, 'startup'),
        CM_LOCATION_CATALOGUE_PATH: fileURLToPath(new URL('./fixtures/service-locations.json', import.meta.url)),
        CM_PUBLIC_ORIGIN: 'https://cm.test', CM_TRUSTED_PROXY_KEY: 'unit-test-key-only-at-least-32-characters' },
    });
    expect(result.stdout).toContain('Server configuration checked.');
  });
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

  it('reloads approved catalogue replacements and fails closed on missing or invalid data', async () => {
    const file = path.join(directory, 'catalogue.json');
    vi.stubEnv('CM_LOCATION_CATALOGUE_PATH', file);
    const row = { community: 'Test community', address: '1 First Road', street: 'First Road' };
    await writeFile(file, JSON.stringify([row]));
    expect(getLocationCatalogue().resolve('pickup', row.community, row.address)).not.toBeNull();
    await writeFile(file, JSON.stringify([{ ...row, address: '222 Second Road', street: 'Second Road' }]));
    expect(getLocationCatalogue().resolve('pickup', row.community, row.address)).toBeNull();
    expect(getLocationCatalogue().search('address', '222', row.community).options).toEqual(['222 Second Road']);
    await writeFile(file, '{invalid');
    expect(getLocationCatalogue().available).toBe(false);
    await rm(file);
    expect(getLocationCatalogue().available).toBe(false);
  });
});

describe('production request access', () => {
  const secret = 'unit-test-proxy-secret-with-at-least-32-characters';
  function configure() {
    vi.stubEnv('CM_AUTH_MODE', 'proxy');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CM_TRUSTED_PROXY_KEY', secret);
    vi.stubEnv('CM_PUBLIC_ORIGIN', 'https://cm.test');
  }
  function request(method = 'GET', headers: Record<string, string> = {}) {
    return new Request('https://cm.test/api/records/id/photos/photo-id', { method, headers: { 'x-cm-proxy-key': secret, 'x-cm-user': 'test-employee', ...headers } });
  }
  it('protects reports and photos when proxy configuration or identity is absent', () => {
    configure();
    expect(accessFailure(request())).toBeNull();
    expect(accessFailure(request('GET', { 'x-cm-user': '' }))?.status).toBe(401);
    expect(accessFailure(request('GET', { 'x-cm-proxy-key': 'forged' }))?.status).toBe(401);
    vi.stubEnv('CM_TRUSTED_PROXY_KEY', '');
    expect(accessFailure(request())?.status).toBe(503);
  });
  it('requires the configured HTTPS origin on mutations', () => {
    configure();
    expect(accessFailure(request('POST', { origin: 'https://cm.test' }))).toBeNull();
    expect(accessFailure(request('PATCH', { origin: 'https://attacker.invalid' }))?.status).toBe(403);
    expect(accessFailure(request('POST'))?.status).toBe(403);
    vi.stubEnv('CM_PUBLIC_ORIGIN', 'http://cm.test');
    expect(accessFailure(request())?.status).toBe(503);
  });
});
