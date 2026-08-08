/* Segmentation bake-off (PLAN.md M2): run the seven real bench photos through
 * candidate fal.ai models and save every cutout for eyeball comparison.
 *
 * Usage:   FAL_KEY=xxx node scripts/bakeoff.mjs [model ...]
 * Output:  test-output/bakeoff/<model>/<photo>.png + summary.md (gitignored)
 *
 * What to judge, per SPEC §5/§10 — for each photo:
 *   1. paint pot / handle behaviour (mounted in 4 of 7 — expect it kept; how cleanly?)
 *   2. thin structures: spears, claws, crests, staff rings, blades
 *   3. edge quality at full resolution (u2net's soft edges were the floor)
 *   4. the backdrop-board photo and the two hand-held photos
 * Then price per image from fal.ai pricing → decides free-tier viability.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.error('Set FAL_KEY. Usage: FAL_KEY=xxx node scripts/bakeoff.mjs [model ...]');
  process.exit(1);
}

const MODELS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['fal-ai/birefnet/v2', 'fal-ai/bria/background/remove'];

const PHOTO_DIR = 'test-photos/bad-photos';
const OUT_DIR = 'test-output/bakeoff';

async function falJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function segment(model, bytes, contentType) {
  const b64 = Buffer.from(bytes).toString('base64');
  const submit = await falJson(`https://queue.fal.run/${model}`, {
    method: 'POST',
    body: JSON.stringify({ image_url: `data:${contentType};base64,${b64}` })
  });
  const deadline = Date.now() + 180_000;
  for (;;) {
    const status = await falJson(submit.status_url);
    if (status.status === 'COMPLETED') break;
    if (status.status === 'FAILED') throw new Error('request failed');
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 750));
  }
  const result = await falJson(submit.response_url);
  const url = result.image?.url;
  if (!url) throw new Error(`no image in response: ${JSON.stringify(result).slice(0, 300)}`);
  const png = await fetch(url);
  if (!png.ok) throw new Error(`image fetch → ${png.status}`);
  return Buffer.from(await png.arrayBuffer());
}

const photos = (await readdir(PHOTO_DIR)).filter((f) => /\.jpe?g$/i.test(f));
console.log(`${photos.length} photos × ${MODELS.length} models\n`);

const rows = [];
for (const model of MODELS) {
  const dir = join(OUT_DIR, model.replaceAll('/', '_'));
  await mkdir(dir, { recursive: true });
  for (const photo of photos) {
    const bytes = await readFile(join(PHOTO_DIR, photo));
    const started = Date.now();
    try {
      const png = await segment(model, bytes, 'image/jpeg');
      const ms = Date.now() - started;
      const out = join(dir, `${basename(photo, '.jpg')}.png`);
      await writeFile(out, png);
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
  `Ran ${new Date().toISOString()} — cutouts in this directory, one folder per model.`,
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
await writeFile(join(OUT_DIR, 'summary.md'), summary);
console.log(`\nSummary → ${join(OUT_DIR, 'summary.md')}`);
