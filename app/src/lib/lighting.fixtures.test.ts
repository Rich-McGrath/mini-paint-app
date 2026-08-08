/* Every image feature is tested against test-photos/bad-photos/ — seven real
 * phone photos at a cluttered bench (CLAUDE.md). Synthetic images only prove
 * the maths; these prove the behaviour on the real input.
 *
 * Segmentation masks come from the paid API, so this test approximates the
 * subject with a centre window — enough to exercise every pipeline step and
 * hold the invariants on real data. M2's bake-off output replaces the proxy
 * with real masks. */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { srgbToL } from './color';
import { correctLighting, DEFAULTS } from './lighting';

const FIXTURE_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '../../../test-photos/bad-photos');
const WIDTH = 256;

interface Fixture {
  name: string;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** Proxy subject: cutout-shaped copy with centre-window alpha. */
  subject: Uint8ClampedArray;
}

const fixtures: Fixture[] = [];

beforeAll(async () => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => /\.jpe?g$/i.test(f));
  expect(files.length).toBe(7);
  for (const name of files) {
    const { data, info } = await sharp(join(FIXTURE_DIR, name))
      .rotate() // respect EXIF orientation
      .resize({ width: WIDTH })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
    const subject = new Uint8ClampedArray(rgba);
    const { width, height } = info;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inWindow =
          x > width * 0.25 && x < width * 0.75 && y > height * 0.2 && y < height * 0.85;
        if (!inWindow) subject[(y * width + x) * 4 + 3] = 0;
      }
    }
    fixtures.push({ name, rgba, width, height, subject });
  }
});

function stats(rgba: Uint8ClampedArray): { Ls: number[]; range: number } {
  const Ls: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! > 8) Ls.push(srgbToL(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!));
  }
  Ls.sort((a, b) => a - b);
  return { Ls, range: Ls[Math.floor(Ls.length * 0.95)]! - Ls[Math.floor(Ls.length * 0.05)]! };
}

/** Grey-world channel imbalance of the non-subject (background) pixels. */
function backgroundImbalance(rgba: Uint8ClampedArray, subject: Uint8ClampedArray): number {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (subject[i + 3]! > 8) continue;
    r += rgba[i]!;
    g += rgba[i + 1]!;
    b += rgba[i + 2]!;
    n++;
  }
  r /= n;
  g /= n;
  b /= n;
  const mean = (r + g + b) / 3;
  return Math.max(Math.abs(r - mean), Math.abs(g - mean), Math.abs(b - mean)) / mean;
}

describe('lighting pipeline on the seven real bench photos', () => {
  it('runs clean on every fixture: sane gains, no clipping introduced, no NaNs', () => {
    for (const f of fixtures) {
      const { rgba: out, params } = correctLighting(f.subject, f.rgba, f.width, f.height);
      expect(params.exposureGain, f.name).toBeGreaterThanOrEqual(DEFAULTS.minExposureGain);
      expect(params.exposureGain, f.name).toBeLessThanOrEqual(DEFAULTS.maxExposureGain);
      for (const gain of params.wbGains) {
        expect(gain, f.name).toBeGreaterThanOrEqual(1 / DEFAULTS.maxWbGain);
        expect(gain, f.name).toBeLessThanOrEqual(DEFAULTS.maxWbGain);
      }
      const { Ls } = stats(out);
      expect(Ls.length, f.name).toBeGreaterThan(0);
      expect(Ls.every((L) => Number.isFinite(L)), f.name).toBe(true);
      // No new clipped highlights: the pipeline may not blow anything to white.
      const clipped = Ls.filter((L) => L > 99).length / Ls.length;
      const clippedBefore = stats(f.subject).Ls.filter((L) => L > 99).length / Ls.length;
      expect(clipped, f.name).toBeLessThanOrEqual(clippedBefore + 0.005);
    }
  });

  it('white balance moves every bench background toward neutral', () => {
    for (const f of fixtures) {
      const before = backgroundImbalance(f.rgba, f.subject);
      const { params } = correctLighting(f.subject, f.rgba, f.width, f.height);
      // Apply the estimated gains to the background and re-measure.
      const balanced = new Uint8ClampedArray(f.rgba);
      for (let i = 0; i < balanced.length; i += 4) {
        balanced[i] = Math.min(255, f.rgba[i]! * params.wbGains[0]);
        balanced[i + 1] = Math.min(255, f.rgba[i + 1]! * params.wbGains[1]);
        balanced[i + 2] = Math.min(255, f.rgba[i + 2]! * params.wbGains[2]);
      }
      const after = backgroundImbalance(balanced, f.subject);
      expect(after, f.name).toBeLessThanOrEqual(before + 0.01);
    }
  });

  it('never expands the subject value range on real photos (no contrast stretch)', () => {
    for (const f of fixtures) {
      const baseline = correctLighting(f.subject, f.rgba, f.width, f.height, {
        shadowLift: 0,
        sharpenAmount: 0
      });
      const full = correctLighting(f.subject, f.rgba, f.width, f.height);
      const rangeBaseline = stats(baseline.rgba).range;
      const rangeFull = stats(full.rgba).range;
      expect(rangeFull, f.name).toBeLessThanOrEqual(rangeBaseline + 1.5);
      const rangeInput = stats(f.subject).range;
      expect(rangeBaseline, f.name).toBeLessThanOrEqual(rangeInput * 1.15);
    }
  });
});
