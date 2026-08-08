/* Visual check for the lighting pipeline (M2 exit test: "white balance visibly
 * corrects the desk-lamp cast"). Runs the seven bench photos through the
 * pipeline with the proxy centre-window mask and writes side-by-side
 * before/after panels to test-output/lighting/ (gitignored).
 *
 * Usage: npx vite-node scripts/lighting-preview.ts
 * Real masks (post bake-off) supersede this for judging cutout quality — this
 * previews tone, not segmentation. */

import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { correctLighting } from '../app/src/lib/lighting';

const PHOTO_DIR = 'test-photos/bad-photos';
const OUT_DIR = 'test-output/lighting';
const WIDTH = 900;

mkdirSync(OUT_DIR, { recursive: true });

const photos = readdirSync(PHOTO_DIR).filter((f) => /\.jpe?g$/i.test(f));
for (const name of photos) {
  const { data, info } = await sharp(join(PHOTO_DIR, name))
    .rotate()
    .resize({ width: WIDTH })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);

  // Proxy subject mask: centre window (real masks arrive with the bake-off).
  const subject = new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inWindow =
        x > width * 0.25 && x < width * 0.75 && y > height * 0.2 && y < height * 0.85;
      if (!inWindow) subject[(y * width + x) * 4 + 3] = 0;
    }
  }

  const { rgba: corrected, params } = correctLighting(subject, rgba, width, height);

  // Panel: original | corrected subject over the (WB'd) original for context.
  const after = new Uint8ClampedArray(rgba);
  for (let p = 0; p < width * height; p++) {
    if (subject[p * 4 + 3]! > 8) {
      after[p * 4] = corrected[p * 4]!;
      after[p * 4 + 1] = corrected[p * 4 + 1]!;
      after[p * 4 + 2] = corrected[p * 4 + 2]!;
    } else {
      after[p * 4] = Math.min(255, rgba[p * 4]! * params.wbGains[0]);
      after[p * 4 + 1] = Math.min(255, rgba[p * 4 + 1]! * params.wbGains[1]);
      after[p * 4 + 2] = Math.min(255, rgba[p * 4 + 2]! * params.wbGains[2]);
    }
  }

  const panel = await sharp({
    create: { width: width * 2 + 8, height, channels: 4, background: '#0e0e11' }
  })
    .composite([
      { input: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length), raw: { width, height, channels: 4 }, left: 0, top: 0 },
      { input: Buffer.from(after.buffer, after.byteOffset, after.length), raw: { width, height, channels: 4 }, left: width + 8, top: 0 }
    ])
    .png()
    .toBuffer();
  const out = join(OUT_DIR, `${name.replace(/\.jpe?g$/i, '')}.png`);
  await sharp(panel).toFile(out);
  console.log(
    `${name}: wb=[${params.wbGains.map((g) => g.toFixed(2)).join(', ')}] exposure=${params.exposureGain.toFixed(2)} → ${out}`
  );
}
