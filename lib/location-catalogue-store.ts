import { readFileSync, statSync } from 'node:fs';
import { cataloguePath } from './storage-config';
import { createLocationCatalogue } from './location-catalogue';

const unavailable = createLocationCatalogue([]);
let cache: { signature: string; catalogue: ReturnType<typeof createLocationCatalogue> } | undefined;

// Keep the private catalogue outside the client bundle and reload atomic file updates.
export function getLocationCatalogue() {
  try {
    const file = cataloguePath();
    const stat = statSync(file);
    const signature = `${file}:${stat.mtimeMs}:${stat.size}`;
    if (cache?.signature === signature) return cache.catalogue;
    const rows: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('The service catalogue must contain an array.');
    const catalogue = createLocationCatalogue(rows);
    cache = { signature, catalogue };
    return catalogue;
  } catch {
    // A missing or invalid replacement must never leave stale selections approved.
    cache = undefined;
    return unavailable;
  }
}
