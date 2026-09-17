// Additive tables keep existing daily records and complaint fields untouched.
export const EVIDENCE_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS report_blockages (
    record_id TEXT PRIMARY KEY NOT NULL REFERENCES report_records(id),
    scope TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason_label TEXT NOT NULL,
    street_from TEXT NOT NULL DEFAULT '',
    street_to TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    vehicle_plates TEXT NOT NULL DEFAULT '',
    request_hash TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS report_photos (
    id TEXT PRIMARY KEY NOT NULL,
    record_id TEXT NOT NULL REFERENCES report_records(id),
    storage_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    position INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_report_photos_record ON report_photos(record_id, position)',
];
