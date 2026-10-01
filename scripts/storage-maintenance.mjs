import { DatabaseSync, backup } from 'node:sqlite';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privatePhotoPath } from '../lib/photo-path.ts';
import { dataDirectory, cataloguePath } from '../lib/storage-config.ts';

function snapshotRecords(database) {
  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite integrity check failed.');
  if (database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite foreign key check failed.');
  return {
    reports: database.prepare('SELECT COUNT(*) AS count FROM report_records').get().count,
    photos: database.prepare('SELECT storage_key, size FROM report_photos ORDER BY storage_key').all(),
  };
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function verifyStorage(directory) {
  const database = new DatabaseSync(path.join(directory, 'reports.sqlite'), { readOnly: true });
  let records;
  try { records = snapshotRecords(database); } finally { database.close(); }
  const files = [];
  for (const photo of records.photos) {
    const bytes = await readFile(privatePhotoPath(directory, photo.storage_key));
    if (bytes.length !== photo.size) throw new Error(`Photo size mismatch: ${photo.storage_key}`);
    files.push({ path: `photos/${photo.storage_key}`, bytes: bytes.length, sha256: hash(bytes) });
  }
  return { reports: records.reports, photos: files.length, files };
}

export async function backupStorage(directory, destination, catalogueFile) {
  directory = path.resolve(directory);
  destination = path.resolve(destination);
  const relative = path.relative(directory, destination);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Put backups outside the live data directory.');
  // Refuse existing destinations. A manifest is written only after full verification.
  await mkdir(destination);
  const database = new DatabaseSync(path.join(directory, 'reports.sqlite'), { readOnly: true });
  try { await backup(database, path.join(destination, 'reports.sqlite')); }
  finally { database.close(); }
  const snapshot = new DatabaseSync(path.join(destination, 'reports.sqlite'), { readOnly: true });
  let records;
  try { records = snapshotRecords(snapshot); } finally { snapshot.close(); }
  for (const photo of records.photos) {
    const target = privatePhotoPath(destination, photo.storage_key);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(privatePhotoPath(directory, photo.storage_key), target);
  }
  await copyFile(catalogueFile, path.join(destination, 'service-locations.json'));
  const result = await verifyStorage(destination);
  const catalogue = await readFile(path.join(destination, 'service-locations.json'));
  const sqlite = await readFile(path.join(destination, 'reports.sqlite'));
  const manifest = { createdAt: new Date().toISOString(), ...result, databaseSha256: hash(sqlite), catalogueSha256: hash(catalogue) };
  await writeFile(path.join(destination, 'backup-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

export async function verifyBackup(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'backup-manifest.json'), 'utf8'));
  const actual = await verifyStorage(directory);
  if (actual.reports !== manifest.reports || JSON.stringify(actual.files) !== JSON.stringify(manifest.files)
      || hash(await readFile(path.join(directory, 'reports.sqlite'))) !== manifest.databaseSha256
      || hash(await readFile(path.join(directory, 'service-locations.json'))) !== manifest.catalogueSha256) {
    throw new Error('Backup manifest verification failed.');
  }
  return { reports: actual.reports, photos: actual.photos };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, destination] = process.argv.slice(2);
    if (!destination || !['backup', 'verify'].includes(command)) throw new Error('Usage: npm run storage:backup -- <new-backup-directory> OR npm run storage:verify -- <backup-directory>');
    if (command === 'backup') {
      process.env.NODE_ENV = 'production';
      const { default: nextEnv } = await import('@next/env');
      nextEnv.loadEnvConfig(process.cwd(), false);
    }
    const result = command === 'backup'
      ? await backupStorage(dataDirectory(), destination, cataloguePath())
      : await verifyBackup(path.resolve(destination));
    console.log(JSON.stringify({ status: 'PASS', reports: result.reports, photos: result.photos, directory: path.resolve(destination) }));
  } catch (error) {
    console.error(`Storage maintenance failed: ${error.message}`);
    process.exitCode = 1;
  }
}
