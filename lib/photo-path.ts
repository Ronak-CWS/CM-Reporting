import path from 'node:path';

const PHOTO_KEY = /^reports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.(?:jpg|png|webp|gif|heic|heif))?$/i;

export function privatePhotoPath(directory: string, key: string) {
  if (!PHOTO_KEY.test(key)) throw new Error('Invalid photo storage key.');
  return path.join(directory, 'photos', ...key.split('/'));
}
