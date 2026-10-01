import { InputError } from './input-error';

export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 30 * 1024 * 1024;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif';

export interface ValidatedPhoto {
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
}

export function photoSelectionError(files: Array<{ name: string; size: number; type: string }>): string {
  if (!files.length) return 'Add at least one photo of the blockage.';
  if (files.length > MAX_PHOTOS) return `Add up to ${MAX_PHOTOS} photos per report.`;
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_PHOTO_BYTES) return 'Keep the photos under 30 MB in total.';
  for (const file of files) {
    if (!file.size) return `${file.name} is empty. Choose another photo.`;
    if (file.size > MAX_PHOTO_BYTES) return `${file.name} is too large. Each photo must be 10 MB or smaller.`;
    const allowedType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
    if (!allowedType.includes(file.type.toLowerCase()) && !(file.type === '' && /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name))) {
      return `${file.name} is not a supported photo. Use JPG, PNG, WebP, GIF, or HEIC.`;
    }
  }
  return '';
}

function detectedPhotoType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'image/png';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
  }
  return null;
}

export async function validatePhotos(files: File[]): Promise<ValidatedPhoto[]> {
  const selectionError = photoSelectionError(files);
  if (selectionError) throw new InputError(selectionError);
  const photos: ValidatedPhoto[] = [];
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const contentType = detectedPhotoType(new Uint8Array(bytes));
    if (!contentType) throw new InputError(`${file.name} does not contain a supported photo. Please choose another image.`);
    // Filenames are display metadata only; storage keys always use generated IDs.
    const fileName = file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 160) || 'photo';
    photos.push({ fileName, contentType, bytes });
  }
  return photos;
}
