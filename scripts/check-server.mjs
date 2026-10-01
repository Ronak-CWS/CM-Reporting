import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import nextEnv from '@next/env';
import { dataDirectory, cataloguePath } from '../lib/storage-config.ts';
import { createLocationCatalogue } from '../lib/location-catalogue.ts';
import { validateAuthenticationConfig } from '../lib/auth-config.ts';

// The service preflight runs before Next sets NODE_ENV and reads its environment files.
process.env.NODE_ENV = 'production';
nextEnv.loadEnvConfig(process.cwd(), false);
try {
  const directory = dataDirectory();
  validateAuthenticationConfig();
  const rows = JSON.parse(await readFile(cataloguePath(), 'utf8'));
  if (!Array.isArray(rows) || !createLocationCatalogue(rows).available) throw new Error('Install the approved service-location catalogue before starting.');
  await mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.write-check-${randomUUID()}`);
  await writeFile(probe, '', { flag: 'wx' });
  await unlink(probe);
  console.log(`Server configuration checked. Private data: ${directory}. Catalogue: ${rows.length} addresses.`);
} catch (error) {
  console.error(`Server configuration failed: ${error.message}`);
  process.exitCode = 1;
}
