import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmailFixture } from './helpers/email-fixture.mjs';
import { privatePhotoPath } from '../lib/photo-path';
import { checkReport } from '../scripts/check-report.mjs';

const directories: string[] = [];
let fixture: Awaited<ReturnType<typeof createEmailFixture>> | undefined;
const now = new Date('2026-11-10T18:00:00Z');
async function tempDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'cm-report-check-'));
  directories.push(directory);
  return directory;
}
async function prepare(options = {}) {
  fixture = await createEmailFixture(await tempDirectory(), options);
  return fixture;
}
afterEach(async () => {
  fixture?.database.close();
  fixture = undefined;
  for (const directory of directories.splice(0)) {
    const relative = path.relative(tmpdir(), directory);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(directory).startsWith('cm-report-check-')) throw new Error('Unexpected fixture directory.');
    await rm(directory, { recursive: true, force: true });
  }
});

describe('read-only production report diagnosis', () => {
  it('prepares the complete PDF without changing records, photos or the email outbox', async () => {
    const { database, directory, keys, originals } = await prepare();
    const tables = ['report_records', 'report_blockages', 'report_photos', 'report_email_outbox'];
    const snapshot = () => tables.map((name) => database.prepare(`SELECT * FROM ${name}`).all());
    const before = snapshot();
    expect(await checkReport(directory, now)).toMatchObject({
      status: 'PASS', day: '2026-11-10', reports: 1, photos: 2, pdfBytes: expect.any(Number), issues: [],
    });
    expect(snapshot()).toEqual(before);
    for (const [index, key] of keys.entries()) expect(await readFile(privatePhotoPath(directory, key))).toEqual(originals[index]);
  });

  it.each(['missing', 'corrupt', 'invalid-key'])('identifies the exact report and photo for %s evidence', async (failure) => {
    const { database, directory, id, keys } = await prepare();
    if (failure === 'missing') await rm(privatePhotoPath(directory, keys[1]));
    if (failure === 'corrupt') await writeFile(privatePhotoPath(directory, keys[1]), Buffer.from('not an image'));
    if (failure === 'invalid-key') database.prepare("UPDATE report_photos SET storage_key = '../outside.jpg' WHERE position = 1").run();
    const result = await checkReport(directory, now);
    expect(result.status).toBe('FAIL');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ stage: 'photo', reportId: id, reference: 'CM-DAY-20261110-TEST01', photo: 2 });
    if (failure === 'missing') expect(result.issues[0]).toMatchObject({ code: 'ENOENT' });
    if (failure === 'corrupt') expect(result.issues[0].error).toContain('unsupported image format');
    expect(database.prepare('SELECT count(*) AS n FROM report_email_outbox').get()?.n).toBe(0);
  });

  it('reports incomplete metadata instead of omitting a report without photos', async () => {
    const { directory, id } = await prepare({ photoCount: 0 });
    expect(await checkReport(directory, now)).toMatchObject({ status: 'FAIL', reports: 1, photos: 0,
      issues: [{ stage: 'report-metadata', reportId: id, error: 'Report evidence is incomplete.' }],
    });
  });

  it('does not create a database when the configured data directory is wrong', async () => {
    const directory = await tempDirectory();
    expect(await checkReport(directory, now)).toMatchObject({ status: 'FAIL', issues: [{ stage: 'database' }] });
    await expect(stat(path.join(directory, 'reports.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a missing production font through the real CLI', async () => {
    const { directory } = await prepare();
    const result = spawnSync(process.execPath, [path.resolve('scripts/check-report.mjs')], {
      cwd: await tempDirectory(), windowsHide: true, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, CM_DATA_DIR: directory, REPORT_EMAIL_ENABLED: 'false' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'FAIL', issues: [
      { stage: 'pdf-engine-or-font', code: 'ENOENT', error: expect.stringContaining('NotoSans-Regular.woff') },
    ] });
  });
});
