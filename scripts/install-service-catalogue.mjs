import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identity = (row) => JSON.stringify([row.community.toLowerCase(), row.address.toLowerCase()]);

function catalogueRows(bytes, label) {
  const rows = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(rows) || !rows.length || rows.some((row) =>
    !row || ['community', 'address', 'street'].some((field) => typeof row[field] !== 'string' || !row[field].trim()))) {
    throw new Error(`${label} is not a valid service-address catalogue.`);
  }
  if (new Set(rows.map(identity)).size !== rows.length) throw new Error(`${label} has duplicate address choices.`);
  return rows;
}

export async function installServiceCatalogue({ destination, sourceDirectory = path.join(appDirectory, 'data'), apply = false }) {
  if (!destination || !path.isAbsolute(destination)) throw new Error('An absolute installed catalogue path is required.');
  const source = await readFile(path.join(sourceDirectory, 'service-locations.json'));
  const sourceAudit = await readFile(path.join(sourceDirectory, 'service-locations-audit.json'));
  const proposed = catalogueRows(source, 'The repository catalogue');
  const audit = JSON.parse(sourceAudit.toString('utf8'));
  if (audit.catalogueAddresses !== proposed.length || audit.addressRefresh?.mode !== 'additions-only') {
    throw new Error('The repository audit does not match an approved additions-only catalogue.');
  }
  const current = await readFile(destination);
  const existing = catalogueRows(current, 'The installed catalogue');
  const proposedByAddress = new Map(proposed.map((row) => [identity(row), row]));
  for (const row of existing) {
    const replacement = proposedByAddress.get(identity(row));
    if (!replacement || ['community', 'address', 'street'].some((field) => replacement[field] !== row[field])) {
      throw new Error(`Update stopped: an installed choice would be removed or changed: ${row.community} / ${row.address}.`);
    }
  }
  const auditDestination = path.join(path.dirname(destination), 'service-locations-audit.json');
  let currentAudit;
  try { currentAudit = await readFile(auditDestination); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const unchanged = current.equals(source) && currentAudit?.equals(sourceAudit);
  const result = { destination, currentChoices: existing.length, proposedChoices: proposed.length,
    addedChoices: proposed.length - existing.length, status: unchanged ? 'already-current' : 'checked' };
  if (!apply || unchanged) return result;

  const token = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const backupDirectory = path.join(path.dirname(destination), 'catalogue-backups', token);
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(path.join(backupDirectory, 'service-locations.json'), current, { flag: 'wx' });
  if (currentAudit) await writeFile(path.join(backupDirectory, 'service-locations-audit.json'), currentAudit, { flag: 'wx' });
  const catalogueTemporary = `${destination}.${token}.tmp`;
  const auditTemporary = `${auditDestination}.${token}.tmp`;
  try {
    await writeFile(catalogueTemporary, source, { flag: 'wx' });
    await writeFile(auditTemporary, sourceAudit, { flag: 'wx' });
    // Install the runtime catalogue last; each file is replaced with an atomic rename.
    await rename(auditTemporary, auditDestination);
    await rename(catalogueTemporary, destination);
    if (!(await readFile(destination)).equals(source) || !(await readFile(auditDestination)).equals(sourceAudit)) {
      throw new Error('Installed files did not match the reviewed source files.');
    }
  } catch (error) {
    throw new Error(`Catalogue installation failed. Original catalogue backup: ${backupDirectory}. ${error.message}`, { cause: error });
  } finally {
    await Promise.allSettled([unlink(catalogueTemporary), unlink(auditTemporary)]);
  }
  return { ...result, status: 'installed', backupDirectory };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !['--check', '--apply'].includes(process.argv[2])) {
      throw new Error('Usage: node scripts/install-service-catalogue.mjs --check|--apply');
    }
    if (path.resolve(process.cwd()) !== appDirectory) throw new Error('Run this command from the CM Reporting application directory.');
    process.env.NODE_ENV = 'production';
    const { default: nextEnv } = await import('@next/env');
    nextEnv.loadEnvConfig(process.cwd(), false);
    const { cataloguePath } = await import('../lib/storage-config.ts');
    console.log(JSON.stringify(await installServiceCatalogue({ destination: cataloguePath(), apply: process.argv[2] === '--apply' }), null, 2));
  } catch (error) {
    console.error(`Catalogue update failed: ${error.message}`);
    process.exitCode = 1;
  }
}
