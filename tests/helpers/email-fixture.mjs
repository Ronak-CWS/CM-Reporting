import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { openEmailOutbox } from '../../lib/email-outbox.js';
import { privatePhotoPath } from '../../lib/photo-path.ts';

export async function createEmailFixture(directory, { photoCount = 2, longDescription = false } = {}) {
  await mkdir(directory, { recursive: true });
  const database = openEmailOutbox(directory);
  const migrations = new URL('../../drizzle/', import.meta.url);
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
    database.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  const id = randomUUID();
  const date = '2026-11-10T09:35:00';
  const description = 'Collection was blocked by a parked vehicle at the cart location. The driver could not safely access the carts.';
  database.prepare(`INSERT INTO report_records (id, reference_number, record_type, occurred_at, reported_at,
    registered_community, site_address, category, priority, status, employee_name, issue_description, created_at, updated_at)
    VALUES (?, ?, 'daily', ?, ?, ?, ?, 'Blocked call', 'High', 'Open', ?, ?, ?, ?)`).run(
    id, 'CM-DAY-20261110-TEST01', date, date, 'Sample community', '123 Example Avenue', 'Test Driver',
    longDescription ? `${description}\n`.repeat(100) + 'END OF LONG DESCRIPTION' : description, date, date);
  database.prepare(`INSERT INTO report_blockages (record_id, scope, reason_code, reason_label, notes, vehicle_plates, request_hash)
    VALUES (?, 'pickup', 'parked_vehicle', 'Vehicle blocking access', ?, 'TEST-123', 'fixture')`)
    .run(id, 'Driver\u2019s note: acc\u00e8s blocked. Photos show the approach and the blocked carts.');
  const originals = [];
  const keys = [];
  for (let index = 0; index < photoCount; index++) {
    const photoId = randomUUID();
    const key = `reports/${id}/${photoId}.png`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
      <rect width="1200" height="800" fill="#dbe7ec"/><rect y="370" width="1200" height="430" fill="#78868b"/>
      <rect x="60" y="120" width="350" height="260" fill="#b9a590"/><path d="M30 120 L235 20 L440 120Z" fill="#5c706f"/>
      <rect x="120" y="180" width="100" height="100" fill="#eaf5f7"/><rect x="300" y="230" width="70" height="150" fill="#6f857d"/>
      <rect x="850" y="310" width="95" height="150" rx="12" fill="#1f6c4e"/><rect x="960" y="310" width="95" height="150" rx="12" fill="#285b8c"/>
      <rect x="360" y="390" width="650" height="180" rx="30" fill="${index % 2 ? '#bb593d' : '#3b678a'}"/>
      <path d="M470 390 L530 270 L820 270 L910 390Z" fill="#455a64"/>
      <path d="M550 290 L795 290 L860 380 L500 380Z" fill="#cce4e9"/>
      <circle cx="500" cy="570" r="65" fill="#273038"/><circle cx="870" cy="570" r="65" fill="#273038"/>
      <rect x="0" y="700" width="1200" height="100" fill="#ffffff"/>
      <text x="40" y="760" font-family="sans-serif" font-size="34" fill="#254939">TEST PHOTO ${index + 1} - illustrative blocked access</text>
    </svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    const target = privatePhotoPath(directory, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    database.prepare(`INSERT INTO report_photos (id, record_id, storage_key, file_name, content_type, size, position)
      VALUES (?, ?, ?, ?, 'image/png', ?, ?)`).run(photoId, id, key, `blocked-access-${index + 1}.png`, bytes.length, index);
    originals.push(bytes);
    keys.push(key);
  }
  return { database, directory, id, originals, keys };
}

// Duplicate only disposable test data; each report owns its own photo files.
export async function cloneEmailFixtureReport(fixture, overrides = {}) {
  const { database, directory } = fixture;
  const id = randomUUID();
  const record = { ...database.prepare('SELECT * FROM report_records WHERE id = ?').get(fixture.id),
    ...overrides, id, reference_number: overrides.reference_number || `TEST-${id}` };
  const fields = Object.keys(record);
  database.prepare(`INSERT INTO report_records (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...Object.values(record));
  const blockage = { ...database.prepare('SELECT * FROM report_blockages WHERE record_id = ?').get(fixture.id), record_id: id };
  const blockageFields = Object.keys(blockage);
  database.prepare(`INSERT INTO report_blockages (${blockageFields.join(',')}) VALUES (${blockageFields.map(() => '?').join(',')})`).run(...Object.values(blockage));
  for (const photo of database.prepare('SELECT * FROM report_photos WHERE record_id = ? ORDER BY position').all(fixture.id)) {
    const photoId = randomUUID();
    const key = `reports/${id}/${photoId}${path.extname(photo.storage_key) || '.jpg'}`;
    const target = privatePhotoPath(directory, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(privatePhotoPath(directory, photo.storage_key)));
    database.prepare(`INSERT INTO report_photos (id, record_id, storage_key, file_name, content_type, size, position)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(photoId, id, key, photo.file_name, photo.content_type, photo.size, photo.position);
  }
  return id;
}
