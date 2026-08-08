import { describe, expect, it } from 'vitest';
import { L_TO_BYTE, srgbToL } from './color';
import {
  correctLighting,
  estimateExposureGain,
  estimateWbGains,
  shadowLiftL
} from './lighting';

/** Build an RGBA image from a grid of L* values (opaque grey subject pixels). */
function greyImage(Ls: number[], width: number): { rgba: Uint8ClampedArray; height: number } {
  const height = Ls.length / width;
  const rgba = new Uint8ClampedArray(Ls.length * 4);
  Ls.forEach((L, p) => {
    const byte = L_TO_BYTE[Math.round(L)]!;
    rgba[p * 4] = byte;
    rgba[p * 4 + 1] = byte;
    rgba[p * 4 + 2] = byte;
    rgba[p * 4 + 3] = 255;
  });
  return { rgba, height };
}

function subjectLs(rgba: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! > 8) out.push(srgbToL(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!));
  }
  return out;
}

function p5p95Range(Ls: number[]): number {
  const s = [...Ls].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)]! - s[Math.floor(s.length * 0.05)]!;
}

describe('white balance', () => {
  it('computes gains that neutralise a warm cast', () => {
    // Orange desk-lamp cast: red high, blue low.
    const rgba = new Uint8ClampedArray(100 * 4);
    for (let p = 0; p < 100; p++) {
      rgba[p * 4] = 200;
      rgba[p * 4 + 1] = 160;
      rgba[p * 4 + 2] = 110;
      rgba[p * 4 + 3] = 0;
    }
    const [gr, gg, gb] = estimateWbGains(rgba, () => true, 1.6);
    expect(gr).toBeLessThan(1); // pull red down
    expect(gb).toBeGreaterThan(1); // push blue up
    expect(gg).toBeCloseTo(1, 0);
  });

  it('returns unity for already-neutral input and for no pixels', () => {
    const grey = new Uint8ClampedArray([128, 128, 128, 0]);
    expect(estimateWbGains(grey, () => true, 1.6)).toEqual([1, 1, 1]);
    expect(estimateWbGains(grey, () => false, 1.6)).toEqual([1, 1, 1]);
  });
});

describe('exposure', () => {
  it('brings an underexposed subject up into the zone', () => {
    const Ls = Array.from({ length: 400 }, (_, i) => 15 + (i % 20)); // murky: L* 15–34
    const { rgba } = greyImage(Ls, 20);
    const { rgba: out } = correctLighting(rgba, null, 20, 20, {
      shadowLift: 0,
      sharpenAmount: 0
    });
    const after = subjectLs(out).sort((a, b) => a - b);
    const median = after[Math.floor(after.length / 2)]!;
    expect(median).toBeGreaterThanOrEqual(38); // at the zone's lower edge…
    expect(median).toBeLessThanOrEqual(45); // …not dragged to its centre
  });

  it('respects a deliberate paint key: no correction inside the zone, gentle at the edges', () => {
    // A high-key scheme (median L* ~65): darken at most to the zone edge, mildly.
    const light = greyImage(Array.from({ length: 400 }, (_, i) => 55 + (i % 21)), 20);
    const lightOut = correctLighting(light.rgba, null, 20, 20, {
      shadowLift: 0,
      sharpenAmount: 0
    });
    expect(lightOut.params.exposureGain).toBeGreaterThanOrEqual(0.75); // the darkening floor
    expect(lightOut.params.exposureGain).toBeLessThan(1);

    // A mid-key scheme already in the zone: untouched.
    const mid = greyImage(Array.from({ length: 400 }, (_, i) => 42 + (i % 11)), 20);
    const midOut = correctLighting(mid.rgba, null, 20, 20, { shadowLift: 0, sharpenAmount: 0 });
    expect(midOut.params.exposureGain).toBe(1);
  });

  it('never introduces clipping', () => {
    // Dark median but genuine highlights near white.
    const Ls = [...Array.from({ length: 380 }, () => 25), ...Array.from({ length: 20 }, () => 93)];
    const { rgba } = greyImage(Ls, 20);
    const { rgba: out } = correctLighting(rgba, null, 20, 20, {
      shadowLift: 0,
      sharpenAmount: 0
    });
    expect(Math.max(...subjectLs(out))).toBeLessThanOrEqual(99);
  });

  it('clamps runaway gains', () => {
    const zone: [number, number] = [40, 60];
    expect(estimateExposureGain(new Float32Array([0.001]), zone, 3, 0.75)).toBeLessThanOrEqual(3);
    expect(estimateExposureGain(new Float32Array([0.9]), zone, 3, 0.75)).toBeGreaterThanOrEqual(0.75);
    expect(estimateExposureGain(new Float32Array(), zone, 3, 0.75)).toBe(1);
  });

  it('clip guard never cancels a darkening correction', () => {
    // Overexposed subject (median above the zone) with WB-pushed highlights
    // beyond white: the guard must keep the gain at or below the computed
    // darkening, never raise it back toward 1 (which would add clipping).
    const zone: [number, number] = [40, 60];
    const Y = new Float32Array(200).fill(0.5); // median L* ≈ 76 → darkening
    Y[199] = 1.3; // clipped highlight after WB
    Y[198] = 1.3;
    const gain = estimateExposureGain(Y, zone, 3, 0.75);
    expect(gain).toBeLessThan(1);
    expect(gain).toBeGreaterThanOrEqual(0.75);
  });
});

describe('shadow lift', () => {
  it('lifts deep shadows most, fades to nothing at the threshold, touches nothing above', () => {
    expect(shadowLiftL(0, 6, 35)).toBeCloseTo(6, 5);
    expect(shadowLiftL(20, 6, 35)).toBeGreaterThan(20);
    expect(shadowLiftL(20, 6, 35) - 20).toBeLessThan(6);
    expect(shadowLiftL(35, 6, 35)).toBe(35);
    expect(shadowLiftL(70, 6, 35)).toBe(70);
  });

  it('is monotonic — never reorders values', () => {
    let prev = -1;
    for (let L = 0; L <= 100; L += 0.5) {
      const out = shadowLiftL(L, 6, 35);
      expect(out).toBeGreaterThanOrEqual(prev);
      expect(out).toBeGreaterThanOrEqual(L); // and never darkens
      prev = out;
    }
  });
});

describe('the rule that must never break', () => {
  it('leaves a correctly-exposed neutral subject essentially untouched', () => {
    const Ls = Array.from({ length: 400 }, (_, i) => 40 + (i % 21)); // median ~50
    const { rgba } = greyImage(Ls, 20);
    const { rgba: out, params } = correctLighting(rgba, null, 20, 20, { sharpenAmount: 0 });
    expect(params.exposureGain).toBeCloseTo(1, 1);
    for (let i = 0; i < rgba.length; i++) {
      expect(Math.abs(out[i]! - rgba[i]!)).toBeLessThanOrEqual(2);
    }
  });

  it('never expands the subject value range: no contrast stretching', () => {
    // A deliberately flat painting: narrow value band, slightly underexposed.
    // If the pipeline widens this beyond what correct exposure reveals, it is
    // lying about the painting.
    const Ls = Array.from({ length: 900 }, (_, i) => 30 + (i % 12));
    const { rgba } = greyImage(Ls, 30);

    const wbExpOnly = correctLighting(rgba, null, 30, 30, { shadowLift: 0, sharpenAmount: 0 });
    const tonal = correctLighting(rgba, null, 30, 30, { sharpenAmount: 0 });

    const rangeInput = p5p95Range(subjectLs(rgba));
    const rangeBaseline = p5p95Range(subjectLs(wbExpOnly.rgba));
    const rangeTonal = p5p95Range(subjectLs(tonal.rgba));

    // Exposure is a monotonic scale: it reveals range, it cannot manufacture
    // value steps. In L* terms a linear gain g multiplies range by exactly
    // g^(1/3) (L* ∝ Y^(1/3)) — the range the painting would have shown had the
    // camera exposed it correctly. Anything beyond that bound is stretching.
    const gain = wbExpOnly.params.exposureGain;
    expect(rangeBaseline).toBeLessThanOrEqual(rangeInput * Math.cbrt(gain) * 1.05);

    // Shadow lift may compress the range, never expand it.
    expect(rangeTonal).toBeLessThanOrEqual(rangeBaseline + 0.5);
  });

  it('sharpening adds bounded local acutance, not tonal range', () => {
    // A hard value edge: worst case for unsharp overshoot.
    const Ls = Array.from({ length: 400 }, (_, i) => (i % 20 < 10 ? 20 : 60));
    const { rgba } = greyImage(Ls, 20);

    const unsharpened = correctLighting(rgba, null, 20, 20, { sharpenAmount: 0 });
    const sharpened = correctLighting(rgba, null, 20, 20);

    const a = subjectLs(unsharpened.rgba);
    const b = subjectLs(sharpened.rgba);
    // Overshoot at the edge stays local and bounded…
    const maxDelta = Math.max(...b.map((L, i) => Math.abs(L - a[i]!)));
    expect(maxDelta).toBeGreaterThan(0); // it does sharpen
    expect(maxDelta).toBeLessThanOrEqual(8);
    // …and pixels away from any edge are untouched.
    expect(Math.abs(b[4]! - a[4]!)).toBeLessThanOrEqual(0.5);
  });
});
