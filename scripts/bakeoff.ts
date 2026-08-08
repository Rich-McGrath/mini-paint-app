/* Segmentation bake-off (PLAN.md M2): run the seven real bench photos through
 * candidate fal.ai models and save every cutout for eyeball comparison.
 *
 * Uses the production FalProvider — the vendor is evaluated through exactly
 * the client, timeouts, and payloads production uses, so the bake-off cannot
 * drift from what ships.
 *
 * Usage:   FAL_KEY=xxx npx vite-node scripts/bakeoff.ts [model ...]
 * Output:  test-output/bakeoff/<model>/<photo>.png + summary.md (gitignored)
 *
 * What to judge, per SPEC §5/§10 — for each photo:
 *   1. paint pot / handle behaviour (mounted in 4 of 7 — expect it kept; how cleanly?)
 *   2. thin structures: spears, claws, crests, staff rings, blades
 *   3. edge quality at full resolution (u2net's soft edges were the floor)
 *   4. the backdrop-board photo and the two hand-held photos
 * Then price per image from fal.ai pricing → decides free-tier viability. */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FalProvider } from '../worker/src/segmentation';

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.error('Set FAL_KEY. Usage: FAL_KEY=xxx npx vite-node scripts/bakeoff.ts [model ...]');
  process.exit(1);
}

const MODELS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['fal-ai/birefnet/v2', 'fal-ai/bria/background/remove'];

const PHOTO_DIR = 'test-photos/bad-photos';
const OUT_DIR = 'test-output/bakeoff';

const photos = readdirSync(PHOTO_DIR).filter((f) => /\.jpe?g$/i.test(f));
console.log(`${photos.length} photos × ${MODELS.length} models\n`);

interface Row {
  model: string;
  photo: string;
  ms: number;
  ok: boolean;
  err?: string;
}

const rows: Row[] = [];
for (const model of MODELS) {
  const provider = new FalProvider(FAL_KEY, model);
  const dir = join(OUT_DIR, model.replaceAll('/', '_'));
  mkdirSync(dir, { recursive: true });
  for (const photo of photos) {
    const bytes = new Uint8Array(readFileSync(join(PHOTO_DIR, photo)));
    const started = Date.now();
    try {
      const { cutoutPng } = await provider.segment(bytes, 'image/jpeg');
      const ms = Date.now() - started;
      writeFileSync(join(dir, `${basename(photo, '.jpg')}.png`), cutoutPng);
      rows.push({ model, photo, ms, ok: true });
      console.log(`✓ ${model}  ${photo}  ${(ms / 1000).toFixed(1)}s`);
    } catch (err) {
      rows.push({ model, photo, ms: Date.now() - started, ok: false, err: String(err) });
      console.error(`✗ ${model}  ${photo}  ${err}`);
    }
  }
}

const summary = [
  '# Bake-off results',
  '',
  `Ran ${new Date().toISOString()} via the production FalProvider — cutouts in this directory, one folder per model.`,
  '',
  '| Model | Photo | Time | OK |',
  '|---|---|---|---|',
  ...rows.map(
    (r) => `| ${r.model} | ${r.photo} | ${(r.ms / 1000).toFixed(1)}s | ${r.ok ? '✓' : `✗ ${r.err}`} |`
  ),
  '',
  'Judge each cutout on: pot/handle behaviour, thin structures, edge quality,',
  'the backdrop-board photo, the two hand-held photos. Note per-image price from',
  'fal.ai pricing next to the winner — it decides the free tier.',
  ''
].join('\n');
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'summary.md'), summary);
console.log(`\nSummary → ${join(OUT_DIR, 'summary.md')}`);
