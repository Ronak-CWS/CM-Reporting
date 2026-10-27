import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { EMAIL_OUTBOX_SQL } from '../lib/email-outbox.js';
import { removeDailyReport } from '../scripts/remove-daily-report.mjs';

const reference = 'CM-DAY-20261027-657EEA';
const directories: string[] = [];
const databases: DatabaseSync[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
    if (!relative.startsWith('cm-delete-test-') || relative.includes(path.sep)) throw new Error('Unexpected test cleanup path.');
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'cm-delete-test-'));
  directories.push(directory);
  const database = new DatabaseSync(path.join(directory, 'reports.sqlite'));
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  for (const migration of ['0000_tricky_whizzer.sql', '0001_wooden_sabra.sql', '0002_complaint_other_reason.sql']) {
    database.exec(await readFile(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'));
  }
  database.exec(EMAIL_OUTBOX_SQL);
  const target = randomUUID();
  const keeper = randomUUID();
  const insert = database.prepare(`INSERT INTO report_records
    (id, reference_number, record_type, occurred_at, reported_at, registered_community,
     site_address, category, employee_name, issue_description, created_at, updated_at)
    VALUES (?, ?, ?, '2026-10-27T18:32:00Z', '2026-10-27T18:32:00Z', 'Anzac', ?,
      'Other', 'Test employee', ?, '2026-10-27T18:32:00Z', '2026-10-27T18:32:00Z')`);
  database.exec('BEGIN');
  for (let index = 0; index < 343; index++) {
    insert.run(`complaint-${index}`, `CM-CMP-${index}`, 'complaint', `${index} Complaint Road`, `Complaint ${index}`);
    database.prepare('INSERT INTO report_complaint_details VALUES (?, ?)').run(`complaint-${index}`, `Original detail ${index}`);
  }
  insert.run(target, reference, 'daily', '100 HOPEGOOD BAY', 'Accidental test report');
  insert.run(keeper, 'CM-DAY-20261027-ABCDEF', 'daily', '200 Keep Road', 'Keep this report');
  for (const id of [target, keeper]) {
    database.prepare(`INSERT INTO report_blockages (record_id, scope, reason_code, reason_label, request_hash)
      VALUES (?, 'pickup', 'blocked', 'Blocked', 'test-hash')`).run(id);
  }
  for (const id of [target, keeper, 'complaint-0']) {
    database.prepare(`INSERT INTO report_email_outbox
      (id, report_id, recipient, subject, body, message_id, next_attempt_at)
      VALUES (?, ?, 'office@example.invalid', 'Test subject', 'Test body', ?, 0)`).run(randomUUID(), id, randomUUID());
  }
  database.exec('COMMIT');
  const files: string[] = [];
  for (const id of [target, keeper]) {
    const photoId = randomUUID();
    const key = `reports/${id}/${photoId}.jpg`;
    const file = path.join(directory, 'photos', ...key.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from([1, 2, 3]));
    database.prepare('INSERT INTO report_photos VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(photoId, id, key, 'test.jpg', 'image/jpeg', 3, 0);
    files.push(file);
  }
  return { directory, database, target, keeper, files };
}

describe('single daily report cleanup without a backup', () => {
  it('previews through the actual CLI without changing records or photos', async () => {
    const { directory, database, files } = await fixture();
    const result = await promisify(execFile)(process.execPath, [
      'scripts/remove-daily-report.mjs', reference, '--data-dir', directory,
    ]);
    expect(result.stdout).toContain('"status": "PREVIEW"');
    expect(result.stdout).toContain('100 HOPEGOOD BAY');
    expect(database.prepare('SELECT COUNT(*) AS count FROM report_records').get()?.count).toBe(345);
    expect(await readFile(files[0])).toEqual(Buffer.from([1, 2, 3]));
  });

  it('removes only the selected daily report and its links/photo, preserving all 343 complaints and another daily report', async () => {
    const { directory, database, target, files } = await fixture();
    const remaining = database.prepare('SELECT * FROM report_records WHERE id != ? ORDER BY id').all(target);
    const details = database.prepare('SELECT * FROM report_complaint_details ORDER BY record_id').all();
    const outbox = database.prepare('SELECT * FROM report_email_outbox WHERE report_id != ? ORDER BY id').all(target);
    const result = removeDailyReport({ directory, reference, apply: true });
    expect(result).toMatchObject({ status: 'DELETED', before: { daily: 2, complaint: 343 },
      after: { daily: 1, complaint: 343 }, otherRecordsUnchanged: true, photosDeleted: 1, photoCleanupErrors: [] });
    expect(database.prepare('SELECT * FROM report_records ORDER BY id').all()).toEqual(remaining);
    expect(database.prepare('SELECT * FROM report_complaint_details ORDER BY record_id').all()).toEqual(details);
    expect(database.prepare('SELECT * FROM report_email_outbox ORDER BY id').all()).toEqual(outbox);
    expect(database.prepare('SELECT * FROM report_blockages WHERE record_id = ?').get(target)).toBeUndefined();
    expect(database.prepare('SELECT * FROM report_photos WHERE record_id = ?').get(target)).toBeUndefined();
    await expect(readFile(files[0])).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(files[1])).toEqual(Buffer.from([1, 2, 3]));
  });

  it('refuses a complaint, an unmatched reference, and a mistyped daily record', async () => {
    const { directory, database, target } = await fixture();
    expect(() => removeDailyReport({ directory, reference: 'CM-CMP-0', apply: true })).toThrow('cannot delete complaints');
    expect(() => removeDailyReport({ directory, reference: 'CM-DAY-20261027-000000', apply: true })).toThrow('exactly one');
    database.prepare("UPDATE report_records SET record_type = 'complaint' WHERE id = ?").run(target);
    expect(() => removeDailyReport({ directory, reference, apply: true })).toThrow('exactly one');
    expect(database.prepare('SELECT COUNT(*) AS count FROM report_records').get()?.count).toBe(345);
  });

  it('rolls back all linked deletions if a database trigger changes a complaint', async () => {
    const { directory, database, target, files } = await fixture();
    database.exec(`CREATE TRIGGER unexpected_change AFTER DELETE ON report_records
      BEGIN UPDATE report_records SET issue_description = 'Changed' WHERE id = 'complaint-0'; END;`);
    expect(() => removeDailyReport({ directory, reference, apply: true })).toThrow('rolled back');
    expect(database.prepare('SELECT issue_description FROM report_records WHERE id = ?').get('complaint-0')?.issue_description).toBe('Complaint 0');
    expect(database.prepare('SELECT id FROM report_records WHERE id = ?').get(target)).toBeTruthy();
    expect(database.prepare('SELECT record_id FROM report_blockages WHERE record_id = ?').get(target)).toBeTruthy();
    expect(database.prepare('SELECT id FROM report_photos WHERE record_id = ?').get(target)).toBeTruthy();
    expect(database.prepare('SELECT id FROM report_email_outbox WHERE report_id = ?').get(target)).toBeTruthy();
    expect(await readFile(files[0])).toEqual(Buffer.from([1, 2, 3]));
  });

  it('refuses a photo belonging to another report before changing anything', async () => {
    const { directory, database, target, keeper, files } = await fixture();
    const key = database.prepare('SELECT storage_key FROM report_photos WHERE record_id = ?').get(keeper)?.storage_key;
    database.prepare('UPDATE report_photos SET storage_key = ? WHERE record_id = ?').run(String(key), target);
    expect(() => removeDailyReport({ directory, reference, apply: true })).toThrow('Unexpected photo path');
    expect(database.prepare('SELECT COUNT(*) AS count FROM report_records').get()?.count).toBe(345);
    expect(await readFile(files[1])).toEqual(Buffer.from([1, 2, 3]));
  });

  it('rolls back if a trigger recreates a queued notification for the deleted report', async () => {
    const { directory, database, target } = await fixture();
    database.exec(`CREATE TRIGGER requeue AFTER DELETE ON report_records BEGIN
      INSERT INTO report_email_outbox (id, report_id, recipient, subject, body, message_id, next_attempt_at)
      VALUES ('unexpected', OLD.id, 'office@example.invalid', 'Test', 'Test', 'test-id', 0); END;`);
    expect(() => removeDailyReport({ directory, reference, apply: true })).toThrow('rolled back');
    expect(database.prepare('SELECT id FROM report_records WHERE id = ?').get(target)).toBeTruthy();
    expect(database.prepare('SELECT id FROM report_email_outbox WHERE id = ?').get('unexpected')).toBeUndefined();
  });

  it('refuses an in-flight notification and supports installations without an email outbox', async () => {
    const { directory, database, target } = await fixture();
    database.prepare('UPDATE report_email_outbox SET locked_until = ? WHERE report_id = ?').run(Date.now() + 300000, target);
    expect(() => removeDailyReport({ directory, reference, apply: true })).toThrow('email currently being processed');
    database.exec('DROP TABLE report_email_outbox');
    expect(removeDailyReport({ directory, reference, apply: true })).toMatchObject({ after: { daily: 1, complaint: 343 } });
  });
});
