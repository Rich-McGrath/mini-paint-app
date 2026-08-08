/* Normalise a phone photo before upload: decode (using the browser's native
 * codecs — Safari reads HEIC), bake EXIF orientation, downscale to the working
 * maximum, re-encode as JPEG. Fixes the two classic iPhone failure modes
 * (HEIC uploads, sideways photos) and cuts a 4–8 MB camera file to well under
 * a megabyte — bandwidth is the main cost (SPEC §2). The user's original file
 * never leaves the device modified; this is a derived upload copy. */

import { WORKING_DIM } from './dims';

const JPEG_QUALITY = 0.9;

export async function normalizeForUpload(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("Couldn't read that photo. Try a JPEG or PNG.");
  }
  try {
    const scale = Math.min(1, WORKING_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Couldn't process that photo."))),
        'image/jpeg',
        JPEG_QUALITY
      )
    );
  } finally {
    bitmap.close();
  }
}
