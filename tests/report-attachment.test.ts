import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockedCallAttachments, dailyBlockedCallAttachments, emailPhoto } from '../lib/report-attachment.js';
import { deliverQueuedEmails } from '../lib/email-outbox.js';
import { privatePhotoPath } from '../lib/photo-path';
import { cloneEmailFixtureReport, createEmailFixture } from './helpers/email-fixture.mjs';

let fixture: Awaited<ReturnType<typeof createEmailFixture>> | undefined;
afterEach(async () => {
  if (fixture) { fixture.database.close(); await rm(fixture.directory, { recursive: true, force: true }); fixture = undefined; }
});
async function prepare(options = {}) {
  fixture = await createEmailFixture(await mkdtemp(path.join(tmpdir(), 'cm-report-attachment-')), options);
  return fixture;
}

describe('blocked-call PDF attachment', () => {
  it('keeps exceptionally long reports and all six photos together on one taller page and preserves originals', async () => {
    const { database, directory, id, originals, keys } = await prepare({ photoCount: 6, longDescription: true });
    const [attachment] = await blockedCallAttachments(database, directory, id);
    expect(attachment.filename).toBe('CM-DAY-20261110-TEST01-blocked-call.pdf');
    expect(attachment.content.length).toBeLessThan(5 * 1024 * 1024);
    const pdf = await PDFDocument.load(attachment.content);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBe(612);
    expect(pdf.getPage(0).getHeight()).toBeGreaterThan(792);
    let imageCount = 0;
    for (const page of pdf.getPages()) {
      const objects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
      if (objects) for (const [, reference] of objects.entries()) {
        const object = pdf.context.lookup(reference);
        if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') imageCount++;
      }
    }
    expect(imageCount).toBe(6);
    for (let index = 0; index < keys.length; index++) expect(await readFile(privatePhotoPath(directory, keys[index]))).toEqual(originals[index]);
  }, 60000);

  it('fits four short one-photo records per Letter page and moves the fifth record with its photo', async () => {
    const current = await prepare({ photoCount: 1 });
    const { database, directory, id } = current;
    database.prepare("UPDATE report_records SET site_address = '142 Cardinal Drive', registered_community = 'Fort McMurray', service_type = 'Recycling', issue_description = 'Pickup blocked. Reason: Bin not out.'").run();
    database.prepare("UPDATE report_blockages SET reason_label = 'Bin not out', notes = '', vehicle_plates = ''").run();
    const ids = [id];
    for (let index = 1; index < 9; index++) ids.push(await cloneEmailFixtureReport(current, { reference_number: `CM-LAYOUT-${index + 1}` }));
    const [attachment] = await dailyBlockedCallAttachments(database, directory, ids, '2026-11-10');
    const pdf = await PDFDocument.load(attachment.content);
    expect(pdf.getPageCount()).toBe(3);
    const counts = pdf.getPages().map((page) => {
      expect(page.getSize()).toEqual({ width: 612, height: 792 });
      const objects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
      return objects ? objects.entries().filter(([, ref]) => {
        const object = pdf.context.lookup(ref);
        return object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image';
      }).length : 0;
    });
    expect(counts).toEqual([4, 4, 1]);
  }, 60000);

  it('delivers a real PDF through the automatic outbox and marks acceptance only after the send', async () => {
    const { database, id } = await prepare();
    database.prepare(`INSERT INTO report_email_outbox (id, report_id, recipient, subject, body, message_id, next_attempt_at)
      VALUES ('notification', ?, 'office@example.invalid', 'Blocked call', 'Saved report', '<report@example.invalid>', 0)`).run(id);
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await deliverQueuedEmails(database, { send })).toEqual({ sent: 1, deferred: 0 });
    const message = send.mock.calls[0][0];
    expect(message.attachments).toHaveLength(1);
    expect((await PDFDocument.load(message.attachments[0].content)).getPageCount()).toBe(1);
    expect(database.prepare('SELECT sent_at FROM report_email_outbox').get()?.sent_at).toBeTypeOf('number');
  });

  it.each(['missing', 'corrupt', 'invalid-key'])('refuses to omit a %s photo', async (failure) => {
    const { database, directory, id, keys } = await prepare();
    if (failure === 'missing') await rm(privatePhotoPath(directory, keys[0]));
    if (failure === 'corrupt') await writeFile(privatePhotoPath(directory, keys[0]), Buffer.from('not an image'));
    if (failure === 'invalid-key') database.prepare("UPDATE report_photos SET storage_key = '../outside.jpg' WHERE position = 0").run();
    await expect(blockedCallAttachments(database, directory, id)).rejects.toMatchObject({ code: 'EATTACHMENT' });
  });

  it('resizes and auto-orients a large photo while preserving its aspect ratio', async () => {
    const bytes = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#168c70' } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const result = await emailPhoto(bytes, 'image/jpeg');
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(1600);
    expect(result.length).toBeLessThanOrEqual(600 * 1024);
  });

  it.each(['webp', 'gif'] as const)('embeds %s uploads as compact JPEG copies', async (format) => {
    const source = await sharp({ create: { width: 100, height: 80, channels: 4, background: '#ff006688' } }).toFormat(format).toBuffer();
    const result = await emailPhoto(source, `image/${format}`);
    expect((await sharp(result).metadata()).format).toBe('jpeg');
  });
});
