import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installServiceCatalogue } from '../scripts/install-service-catalogue.mjs';

const original = { community: 'Brooks', address: '1 Example St', street: 'Example St' };
const addition = { community: 'Brooks', address: '37 Meadow Lake Gate E', street: 'Meadow Lake Gate E' };
let directory: string;
let sourceDirectory: string;
let privateDirectory: string;
let destination: string;
const json = (value: unknown) => JSON.stringify(value) + '\n';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cm-catalogue-install-'));
  sourceDirectory = path.join(directory, 'checkout-data');
  privateDirectory = path.join(directory, 'private-data');
  await mkdir(sourceDirectory);
  await mkdir(privateDirectory);
  destination = path.join(privateDirectory, 'custom-service-list.json');
  await writeFile(destination, json([original]));
  await writeFile(path.join(privateDirectory, 'service-locations-audit.json'), json({ catalogueAddresses: 1 }));
  await writeFile(path.join(sourceDirectory, 'service-locations.json'), json([original, addition]));
  await writeFile(path.join(sourceDirectory, 'service-locations-audit.json'), json({ catalogueAddresses: 2, addressRefresh: { mode: 'additions-only' } }));
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('install reviewed service catalogue', () => {
  it('checks the configured path without modifying any files', async () => {
    expect(await installServiceCatalogue({ destination, sourceDirectory })).toMatchObject({ status: 'checked', currentChoices: 1, proposedChoices: 2, addedChoices: 1 });
    expect(await readFile(destination, 'utf8')).toBe(json([original]));
    expect(await readdir(privateDirectory)).toEqual(['custom-service-list.json', 'service-locations-audit.json']);
  });

  it('backs up both original catalogue files, installs exact reviewed bytes, and preserves report data', async () => {
    await writeFile(path.join(privateDirectory, 'reports.sqlite'), 'existing database');
    await mkdir(path.join(privateDirectory, 'photos'));
    await writeFile(path.join(privateDirectory, 'photos', 'driver.jpg'), 'original photo');
    const result = await installServiceCatalogue({ destination, sourceDirectory, apply: true });
    expect(result.status).toBe('installed');
    if (!('backupDirectory' in result)) throw new Error('Installed catalogue must report its backup directory.');
    expect(await readFile(path.join(result.backupDirectory!, 'service-locations.json'), 'utf8')).toBe(json([original]));
    expect(await readFile(path.join(result.backupDirectory!, 'service-locations-audit.json'), 'utf8')).toBe(json({ catalogueAddresses: 1 }));
    expect(await readFile(destination)).toEqual(await readFile(path.join(sourceDirectory, 'service-locations.json')));
    expect(await readFile(path.join(privateDirectory, 'service-locations-audit.json'))).toEqual(await readFile(path.join(sourceDirectory, 'service-locations-audit.json')));
    expect(await readFile(path.join(privateDirectory, 'reports.sqlite'), 'utf8')).toBe('existing database');
    expect(await readFile(path.join(privateDirectory, 'photos', 'driver.jpg'), 'utf8')).toBe('original photo');
    expect((await readdir(privateDirectory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    expect(await installServiceCatalogue({ destination, sourceDirectory, apply: true })).toMatchObject({ status: 'already-current', addedChoices: 0 });
  });

  it.each([
    { ...original, address: '9 Local-only St' },
    { ...original, street: 'Locally corrected street' },
  ])('refuses to remove or change an installed address', async (row) => {
    await writeFile(destination, json([row]));
    await expect(installServiceCatalogue({ destination, sourceDirectory, apply: true })).rejects.toThrow('would be removed or changed');
    expect(await readFile(destination, 'utf8')).toBe(json([row]));
  });

  it('refuses a mismatched audit before creating a backup or replacing files', async () => {
    await writeFile(path.join(sourceDirectory, 'service-locations-audit.json'), json({ catalogueAddresses: 99, addressRefresh: { mode: 'additions-only' } }));
    await expect(installServiceCatalogue({ destination, sourceDirectory, apply: true })).rejects.toThrow('audit does not match');
    expect(await readFile(destination, 'utf8')).toBe(json([original]));
  });

  it('can update an installation that has no previous audit file', async () => {
    await rm(path.join(privateDirectory, 'service-locations-audit.json'));
    expect(await installServiceCatalogue({ destination, sourceDirectory, apply: true })).toMatchObject({ status: 'installed' });
    expect(JSON.parse(await readFile(path.join(privateDirectory, 'service-locations-audit.json'), 'utf8')).catalogueAddresses).toBe(2);
  });
});
