import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailFixture } from './helpers/email-fixture.mjs';
import { PDFDocument } from 'pdf-lib';
import { privatePhotoPath } from '../lib/photo-path';
import * as reportAttachments from '../lib/report-attachment.js';
import { reportSizeError } from '../lib/report-limits.js';
import ExcelJS from 'exceljs';

const runtime = vi.hoisted(() => ({ sqlite: undefined as DatabaseSync | undefined, directory: '' }));
const smtp = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../lib/local-storage', async (original) => ({ ...await original<typeof import('../lib/local-storage')>(),
  getLocalStorage: () => ({ sqlite: runtime.sqlite, directory: runtime.directory }) }));
vi.mock('../lib/smtp.js', async (original) => ({ ...await original<typeof import('../lib/smtp.js')>(), sendEmail: smtp.send }));

import { GET, POST } from '../app/api/email/blocked-calls/route';
import { GET as download } from '../app/api/email/blocked-calls/report/route';
let fixture: Awaited<ReturnType<typeof createEmailFixture>>;
const request = (method = 'POST', origin = 'https://cm.test', from = 'test-sender@example.invalid', to?: unknown) => new Request('https://cm.test/api/test', {
  method, headers: { origin, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ from, to }) } : {}) });

beforeEach(async () => {
  fixture = await createEmailFixture(await mkdtemp(path.join(tmpdir(), 'cm-email-test-')));
  runtime.sqlite = fixture.database;
  runtime.directory = fixture.directory;
  for (const [name, value] of Object.entries({ CM_AUTH_MODE: 'development', CM_PUBLIC_ORIGIN: 'https://cm.test',
    REPORT_EMAIL_ENABLED: 'false', REPORT_EMAIL_TO: 'automatic@example.invalid', REPORT_EMAIL_TEST_TO: 'one@example.invalid,two@example.invalid',
    SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '25', SMTP_AUTH_MODE: 'none', SMTP_SECURE: 'false',
    SMTP_REQUIRE_TLS: 'true', SMTP_IGNORE_TLS: 'false', EMAIL_FROM: 'sender@example.invalid', EMAIL_TEST_FROM_OPTIONS: 'test-sender@example.invalid,alternate@example.invalid' })) vi.stubEnv(name, value);
  smtp.send.mockReset().mockResolvedValue(undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T18:00:00Z'));
});
afterEach(async () => { fixture.database.close(); await rm(fixture.directory, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('selected report email test', () => {
  it('shows approved recipients and sends the actual PDF even with automatic emails disabled', async () => {
    const settings = await GET(request('GET'));
    expect(await settings.json()).toMatchObject({ day: '2026-11-10', reportCount: 1, photoCount: 2, recipients: ['one@example.invalid', 'two@example.invalid'], senders: ['test-sender@example.invalid', 'alternate@example.invalid'], automaticEnabled: false });
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ accepted: ['one@example.invalid', 'two@example.invalid'], failed: [] });
    expect(smtp.send).toHaveBeenCalledTimes(2);
    expect(smtp.send.mock.calls[0][1]).toEqual({ testFrom: 'test-sender@example.invalid' });
    expect(smtp.send.mock.calls[0][0].subject).toContain('[CM Reporting TEST]');
    expect((await PDFDocument.load(smtp.send.mock.calls[0][0].attachments[0].content)).getPageCount()).toBe(1);
    expect(fixture.database.prepare('SELECT count(*) AS n FROM report_records').get()?.n).toBe(1);
    expect(fixture.database.prepare('SELECT count(*) AS n FROM report_email_outbox').get()?.n).toBe(0);
    expect((await POST(request())).status).toBe(429);
    expect(smtp.send).toHaveBeenCalledTimes(2);
    const secondSender = await POST(request('POST', 'https://cm.test', 'alternate@example.invalid'));
    expect((await secondSender.json()) as object).toMatchObject({ accepted: ['one@example.invalid', 'two@example.invalid'], failed: [] });
    expect(smtp.send).toHaveBeenCalledTimes(4);
    expect(smtp.send.mock.calls[2][1]).toEqual({ testFrom: 'alternate@example.invalid' });
  });

  it('returns separate accepted and failed recipients without exposing provider errors', async () => {
    smtp.send.mockRejectedValueOnce(Object.assign(new Error('secret provider detail'), { code: 'EENVELOPE' }));
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ accepted: ['two@example.invalid'], failed: [{ recipient: 'one@example.invalid', code: 'EENVELOPE' }] });
  });

  it('protects both routes and rejects cross-origin sends and unapproved senders', async () => {
    expect((await POST(request('POST', 'https://outside.invalid'))).status).toBe(403);
    expect(smtp.send).not.toHaveBeenCalled();
    vi.stubEnv('CM_AUTH_MODE', 'proxy');
    vi.stubEnv('CM_TRUSTED_PROXY_KEY', 'test-only-proxy-key-with-over-thirty-two-characters');
    expect((await GET(request('GET'))).status).toBe(401);
    expect((await POST(request())).status).toBe(401);
    expect((await download(request('GET'))).status).toBe(401);
    expect((await download(new Request('https://cm.test/api/test?format=xlsx'))).status).toBe(401);
    vi.stubEnv('CM_AUTH_MODE', 'development');
    expect((await POST(request('POST', 'https://cm.test', 'unapproved@example.invalid'))).status).toBe(400);
    await POST(new Request('https://cm.test/api/test', { method: 'POST', headers: { origin: 'https://cm.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'test-sender@example.invalid', recipients: ['unapproved@example.invalid'] }) }));
    expect(smtp.send.mock.calls.map(([message]) => message.to)).toEqual(['one@example.invalid', 'two@example.invalid']);
  });

  it('replaces default recipients only for this test and keeps the sender cooldown when recipients change', async () => {
    const response = await POST(request('POST', 'https://cm.test', 'test-sender@example.invalid', ' EDITED@example.invalid; second@example.invalid, edited@example.invalid '));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: ['edited@example.invalid', 'second@example.invalid'], failed: [] });
    expect(smtp.send.mock.calls.map(([message]) => message.to)).toEqual(['edited@example.invalid', 'second@example.invalid']);
    expect(smtp.send.mock.calls[0][0].attachments[0].filename).toBe('blocked-calls-2026-11-10.pdf');
    expect(process.env.REPORT_EMAIL_TEST_TO).toBe('one@example.invalid,two@example.invalid');
    expect(process.env.REPORT_EMAIL_TO).toBe('automatic@example.invalid');
    expect(process.env.REPORT_EMAIL_ENABLED).toBe('false');
    expect(await (await GET(request('GET'))).json()).toMatchObject({ recipients: ['one@example.invalid', 'two@example.invalid'] });
    expect(fixture.database.prepare('SELECT count(*) AS n FROM report_email_outbox').get()?.n).toBe(0);
    expect((await POST(request('POST', 'https://cm.test', 'test-sender@example.invalid', 'different@example.invalid'))).status).toBe(429);
    expect(smtp.send).toHaveBeenCalledTimes(2);
  });

  it.each(['', '   \t  '])('uses environment recipients when the override is blank (%j)', async (to) => {
    const response = await POST(request('POST', 'https://cm.test', 'test-sender@example.invalid', to));
    expect(response.status).toBe(200);
    expect(smtp.send.mock.calls.map(([message]) => message.to)).toEqual(['one@example.invalid', 'two@example.invalid']);
  });

  it.each([
    { to: 'not-an-email' }, { to: 'valid@example.invalid, invalid-address' },
    { to: 'valid@example.invalid\r\nBcc: extra@example.invalid' }, { to: '; , ;' },
    { to: ['valid@example.invalid'] }, { to: null }, { to: 123 },
    { to: Array.from({ length: 101 }, (_, index) => `recipient-${index}@example.invalid`).join(',') },
  ])('rejects malformed recipient overrides before sending or claiming a cooldown (%#)', async ({ to }) => {
    const response = await POST(request('POST', 'https://cm.test', 'test-sender@example.invalid', to));
    expect(response.status).toBe(400);
    expect(smtp.send).not.toHaveBeenCalled();
    expect(fixture.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'report_email_test_sender_limits'").get()).toBeUndefined();
  });

  it('downloads the same portable report without sending email or needing SMTP credentials', async () => {
    vi.stubEnv('SMTP_HOST', '');
    const response = await download(request('GET'));
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await PDFDocument.load(await response.arrayBuffer())).getPageCount()).toBe(1);
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it('downloads Excel with embedded photos and keeps the schedule disabled', async () => {
    const response = await download(new Request('https://cm.test/api/test?format=xlsx'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('blocked-calls-2026-11-10.xlsx');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet('Summary')?.getCell('A5').text).toBe('CM-DAY-20261110-TEST01');
    expect(workbook.getWorksheet('Details and photos')?.getImages()).toHaveLength(2);
    expect(smtp.send).not.toHaveBeenCalled();
    expect(process.env.REPORT_EMAIL_ENABLED).toBe('false');
    expect((await download(new Request('https://cm.test/api/test?format=csv'))).status).toBe(400);
  });

  it('does not send when the record, configuration or photo evidence is unavailable', async () => {
    expect((await POST(request('POST', 'https://cm.test', 'invalid-sender'))).status).toBe(400);
    vi.stubEnv('REPORT_EMAIL_TEST_TO', '');
    expect((await GET(request('GET'))).status).toBe(503);
    expect((await POST(request())).status).toBe(503);
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it('keeps private attachment causes out of HTTP responses and does not send incomplete evidence', async () => {
    await rm(privatePhotoPath(fixture.directory, fixture.keys[0]));
    const preview = await download(request('GET'));
    expect(preview.status).toBe(503);
    const previewBody = await preview.text();
    expect(previewBody).not.toContain(fixture.directory);
    expect(previewBody).not.toContain('ENOENT');
    const email = await POST(request());
    expect(email.status).toBe(503);
    const emailBody = await email.json();
    expect(emailBody).toMatchObject({ code: 'EATTACHMENT', error: expect.not.stringContaining(fixture.directory) });
    expect(emailBody).not.toHaveProperty('cause');
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it('explains size limits separately from missing or corrupt photo evidence', async () => {
    const failure = Object.assign(new Error('private internal detail', { cause: reportSizeError('private byte budget') }), { code: 'EATTACHMENT' });
    const build = vi.spyOn(reportAttachments, 'dailyBlockedCallAttachments').mockRejectedValue(failure);
    try {
      for (const response of [await POST(request()), await download(request('GET'))]) {
        expect(response.status).toBe(503);
        const body = await response.text();
        expect(body).toContain('attachment size limit');
        expect(body).not.toContain('Check the saved photos');
        expect(body).not.toContain('private');
      }
      expect(smtp.send).not.toHaveBeenCalled();
    } finally { build.mockRestore(); }
  });
});
