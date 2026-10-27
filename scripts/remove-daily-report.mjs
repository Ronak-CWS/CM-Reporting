import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { realpathSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Administrative, single-record cleanup. Preview by default; no backup is created.
const targetColumns = {
  report_records: 'id', report_blockages: 'record_id',
  report_photos: 'record_id', report_email_outbox: 'report_id',
};
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const photoKey = /^reports\/[0-9a-f-]{36}\/[0-9a-f-]{36}(?:\.(?:jpg|png|webp|gif|heic|heif))?$/i;

function hasTable(database, name) {
  return !!database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name);
}

// Compare every remaining row, including complaint details and unrelated outbox entries.
function protectedState(database, id) {
  const hash = createHash('sha256');
  const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for (const { name } of tables) {
    const column = Object.hasOwn(targetColumns, name) ? targetColumns[name] : null;
    const statement = database.prepare(`SELECT * FROM ${quote(name)}${column ? ` WHERE ${quote(column)} IS NOT ?` : ''}`);
    const rows = column ? statement.all(id) : statement.all();
    hash.update(JSON.stringify([name, rows.map((row) => JSON.stringify(row)).sort()]));
  }
  return hash.digest('hex');
}

function counts(database) {
  const result = { daily: 0, complaint: 0 };
  for (const row of database.prepare('SELECT record_type, COUNT(*) AS count FROM report_records GROUP BY record_type').all()) {
    result[row.record_type] = row.count;
  }
  return result;
}

function photoFiles(database, directory, record, photos) {
  const files = [];
  for (const photo of photos) {
    if (!photoKey.test(photo.storage_key) || photo.storage_key.split('/')[1] !== record.id) {
      throw new Error('Unexpected photo path; nothing was deleted.');
    }
    if (database.prepare('SELECT 1 FROM report_photos WHERE storage_key = ? AND record_id != ?').get(photo.storage_key, record.id)) {
      throw new Error('A photo is shared with another report; nothing was deleted.');
    }
    const file = path.join(directory, 'photos', ...photo.storage_key.split('/'));
    try {
      // Reject redirected paths before any write. Never delete a directory recursively.
      if (path.relative(file, realpathSync(file)) !== '' || !statSync(file).isFile()) {
        throw new Error('Unexpected photo file location; nothing was deleted.');
      }
      files.push(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return files;
}

export function removeDailyReport({ directory, reference, apply = false }) {
  if (!/^CM-DAY-\d{8}-[0-9A-F]{6}$/.test(reference || '')) {
    throw new Error('Provide one complete CM-DAY reference. This script cannot delete complaints.');
  }
  directory = realpathSync(directory);
  const databasePath = path.join(directory, 'reports.sqlite');
  if (!statSync(databasePath).isFile()) throw new Error('The reporting database does not exist.');
  const database = new DatabaseSync(databasePath, { readOnly: !apply });
  let transaction = false;
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    database.exec(apply ? 'BEGIN IMMEDIATE' : 'BEGIN');
    transaction = true;
    const matches = database.prepare('SELECT * FROM report_records WHERE reference_number = ?').all(reference);
    if (matches.length !== 1 || matches[0].record_type !== 'daily') {
      throw new Error('Expected exactly one matching daily report; nothing was deleted.');
    }
    const record = matches[0];
    const photos = hasTable(database, 'report_photos')
      ? database.prepare('SELECT * FROM report_photos WHERE record_id = ?').all(record.id) : [];
    const before = counts(database);
    const result = {
      status: apply ? 'DELETED' : 'PREVIEW', database: databasePath,
      report: { reference, id: record.id, community: record.registered_community,
        address: record.site_address, occurredAt: record.occurred_at, photos: photos.length },
      before,
    };
    if (!apply) {
      database.exec('ROLLBACK');
      transaction = false;
      return result;
    }
    if (hasTable(database, 'report_email_outbox') && database.prepare(
      'SELECT 1 FROM report_email_outbox WHERE report_id = ? AND sent_at IS NULL AND locked_until > ?',
    ).get(record.id, Date.now())) {
      throw new Error('This report has an email currently being processed. Retry after it finishes. Nothing was deleted.');
    }
    const files = photoFiles(database, directory, record, photos);
    const unchanged = protectedState(database, record.id);
    for (const [table, column] of Object.entries(targetColumns)) {
      if (table !== 'report_records' && hasTable(database, table)) {
        database.prepare(`DELETE FROM ${quote(table)} WHERE ${quote(column)} = ?`).run(record.id);
      }
    }
    const deleted = database.prepare("DELETE FROM report_records WHERE id = ? AND reference_number = ? AND record_type = 'daily'")
      .run(record.id, reference);
    const after = counts(database);
    const targetRemains = Object.entries(targetColumns).some(([table, column]) => hasTable(database, table)
      && database.prepare(`SELECT 1 FROM ${quote(table)} WHERE ${quote(column)} = ?`).get(record.id));
    if (deleted.changes !== 1 || after.daily !== before.daily - 1 || after.complaint !== before.complaint
        || targetRemains || protectedState(database, record.id) !== unchanged || database.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('Preservation check failed; the entire deletion was rolled back.');
    }
    database.exec('COMMIT');
    transaction = false;
    // Original files are removed only after the database transaction succeeds.
    const photoCleanupErrors = [];
    let photosDeleted = 0;
    for (const file of files) {
      try { unlinkSync(file); photosDeleted++; }
      catch (error) {
        if (error.code !== 'ENOENT') photoCleanupErrors.push({ file, code: error.code });
      }
    }
    return { ...result, after, otherRecordsUnchanged: true, photosDeleted, photoCleanupErrors };
  } finally {
    try { if (transaction) database.exec('ROLLBACK'); }
    finally { database.close(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      apply: { type: 'boolean', default: false }, 'data-dir': { type: 'string' },
    } });
    if (positionals.length !== 1) {
      throw new Error('Usage: node scripts/remove-daily-report.mjs CM-DAY-YYYYMMDD-XXXXXX [--data-dir <CM_DATA_DIR>] [--apply]');
    }
    if (!values['data-dir'] && !process.env.CM_DATA_DIR?.trim()) {
      process.env.NODE_ENV = 'production';
      const { default: nextEnv } = await import('@next/env');
      nextEnv.loadEnvConfig(process.cwd(), false);
    }
    const directory = values['data-dir'] || process.env.CM_DATA_DIR?.trim();
    if (!directory || !path.isAbsolute(directory) || directory.startsWith('\\\\')) {
      throw new Error('Use the production CM_DATA_DIR: an absolute path on the server local disk.');
    }
    const result = removeDailyReport({ directory, reference: positionals[0], apply: values.apply });
    console.log(JSON.stringify(result, null, 2));
    if (!values.apply) console.log('Preview only. Check the database, reference and address, then rerun with --apply. No backup will be created.');
    if (result.photoCleanupErrors?.length) {
      console.error('The report was deleted; the listed original photo files could not be removed.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Daily report cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
