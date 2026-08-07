/* Lighting correction — pure image maths, no DOM, testable under Node.
 *
 * The rule that must never break (SPEC §4): fix what the camera got wrong,
 * never what the painter got wrong. White balance, exposure, shadow lift and
 * sharpening are camera corrections. Contrast stretching, auto-levels and
 * saturation changes are forbidden — they manufacture value range the painting
 * doesn't have. lighting.test.ts enforces this as an invariant.
 *
 * All steps work in linear light via the tested conversions in color.ts.
 */

import { lToY, linearToSrgbByte, SRGB_TO_LINEAR, yToL } from './color';

export interface LightingOptions {
  /** Acceptable zone for the subject's median lightness (CIE L*). A zone, not a
   * point: forcing every model's median to one value would normalise deliberate
   * high-key / low-key paint schemes — fixing the painter, which is forbidden.
   * Inside the zone nothing happens; outside, correct to the nearest edge. */
  exposureZone: [number, number];
  /** Per-channel white-balance gain clamp. */
  maxWbGain: number;
  /** Brightening clamp. Generous — bench photos are routinely a stop-plus under. */
  maxExposureGain: number;
  /** Darkening floor. Deliberately timid — overexposure clips irrecoverably, and
   * an apparently bright subject is more often a light paint scheme than a
   * camera error. */
  minExposureGain: number;
  /** L* added at pure black by the shadow lift, fading to 0 at shadowThreshold. */
  shadowLift: number;
  shadowThreshold: number;
  /** Unsharp-mask strength (0 disables). */
  sharpenAmount: number;
  /** Alpha above which a pixel counts as subject. */
  alphaThreshold: number;
}

export const DEFAULTS: LightingOptions = {
  exposureZone: [40, 60],
  maxWbGain: 1.6,
  maxExposureGain: 3.0,
  minExposureGain: 0.75,
  shadowLift: 6,
  shadowThreshold: 35,
  sharpenAmount: 0.3,
  alphaThreshold: 8
};

export interface LightingParams {
  wbGains: [number, number, number];
  exposureGain: number;
  shadowLift: number;
  sharpenAmount: number;
}

type Rgba = Uint8ClampedArray | Uint8Array;

/** Grey-world white balance estimated from the given pixels (the background —
 * that's where the desk-lamp cast lives). Returns linear per-channel gains that
 * would make the estimate neutral, luminance-preserving, clamped. */
export function estimateWbGains(
  rgba: Rgba,
  usePixel: (i: number) => boolean,
  maxGain: number
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (!usePixel(i / 4)) continue;
    r += SRGB_TO_LINEAR[rgba[i]!]!;
    g += SRGB_TO_LINEAR[rgba[i + 1]!]!;
    b += SRGB_TO_LINEAR[rgba[i + 2]!]!;
    n++;
  }
  if (n === 0 || (r === 0 && g === 0 && b === 0)) return [1, 1, 1];
  r /= n;
  g /= n;
  b /= n;
  const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const clamp = (v: number) => Math.min(maxGain, Math.max(1 / maxGain, v));
  return [clamp(grey / (r || grey)), clamp(grey / (g || grey)), clamp(grey / (b || grey))];
}

/** Exposure gain that brings the subject's median lightness into the zone —
 * to the nearest edge, not the centre, so the painting's chosen key survives.
 * Asymmetric clamps, and reduced if it would clip subject highlights. */
export function estimateExposureGain(
  subjectY: Float32Array,
  zone: [number, number],
  maxGain: number,
  minGain: number
): number {
  if (subjectY.length === 0) return 1;
  const sorted = Float32Array.from(subjectY).sort();
  const median = sorted[Math.floor(sorted.length / 2)]!;
  if (median <= 0) return 1;
  const medianL = yToL(median);
  let gain = 1;
  if (medianL < zone[0]) gain = Math.min(maxGain, lToY(zone[0]) / median);
  else if (medianL > zone[1]) gain = Math.max(minGain, lToY(zone[1]) / median);
  // Never introduce clipping: keep the 99.5th percentile below white.
  const p995 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.995))]!;
  if (p995 * gain > 0.97) gain = Math.max(1, 0.97 / p995);
  return gain;
}

/** Shadow lift as an L*-domain curve: +`lift` at black, fading smoothly to
 * nothing at `threshold`. Monotonic, never darkens, touches nothing above the
 * threshold — lifts murk without manufacturing range. */
export function shadowLiftL(L: number, lift: number, threshold: number): number {
  if (L >= threshold) return L;
  const t = 1 - L / threshold;
  return L + lift * t * t;
}

/** In-place unsharp mask on the lightness of subject pixels, mask-aware so the
 * transparent surround produces no edge halos. Returns the new L* map. */
function unsharpL(
  L: Float32Array,
  isSubject: Uint8Array,
  width: number,
  height: number,
  amount: number
): Float32Array {
  // Mask-weighted 3×3 [1,2,1] blur, separable.
  const tmp = new Float32Array(L.length);
  const tmpW = new Float32Array(L.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let acc = 0;
      let wacc = 0;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const j = y * width + xx;
        if (!isSubject[j]) continue;
        const w = dx === 0 ? 2 : 1;
        acc += L[j]! * w;
        wacc += w;
      }
      tmp[i] = acc;
      tmpW[i] = wacc;
    }
  }
  const out = Float32Array.from(L);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!isSubject[i]) continue;
      let acc = 0;
      let wacc = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        const j = yy * width + x;
        const w = dy === 0 ? 2 : 1;
        acc += tmp[j]! * w;
        wacc += tmpW[j]! * w;
      }
      if (wacc === 0) continue;
      const blurred = acc / wacc;
      out[i] = L[i]! + amount * (L[i]! - blurred);
    }
  }
  return out;
}

/** The full correction. `subject` is the cutout RGBA (alpha = mask), modified
 * out of place; `background` supplies pixels for white-balance estimation (the
 * original photo, same dimensions) — pass null to estimate from nothing and
 * skip WB. The original is never modified. */
export function correctLighting(
  subject: Rgba,
  background: Rgba | null,
  width: number,
  height: number,
  options: Partial<LightingOptions> = {}
): { rgba: Uint8ClampedArray; params: LightingParams } {
  const opt = { ...DEFAULTS, ...options };
  const n = width * height;
  const out = new Uint8ClampedArray(subject);

  const isSubject = new Uint8Array(n);
  const subjectIdx: number[] = [];
  for (let p = 0; p < n; p++) {
    if (subject[p * 4 + 3]! > opt.alphaThreshold) {
      isSubject[p] = 1;
      subjectIdx.push(p);
    }
  }

  // 1 — white balance, estimated from background pixels of the original.
  const wbGains: [number, number, number] = background
    ? estimateWbGains(background, (p) => !isSubject[p], opt.maxWbGain)
    : [1, 1, 1];

  // Linear-light subject buffers with WB applied.
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  for (const p of subjectIdx) {
    R[p] = SRGB_TO_LINEAR[subject[p * 4]!]! * wbGains[0];
    G[p] = SRGB_TO_LINEAR[subject[p * 4 + 1]!]! * wbGains[1];
    B[p] = SRGB_TO_LINEAR[subject[p * 4 + 2]!]! * wbGains[2];
  }

  // 2 — exposure from the subject, not the room.
  const Y = new Float32Array(subjectIdx.length);
  subjectIdx.forEach((p, k) => {
    Y[k] = 0.2126 * R[p]! + 0.7152 * G[p]! + 0.0722 * B[p]!;
  });
  const exposureGain = estimateExposureGain(
    Y,
    opt.exposureZone,
    opt.maxExposureGain,
    opt.minExposureGain
  );

  // 3 — shadow lift in L*, hue-preserving (scales linear RGB by the Y ratio).
  const L = new Float32Array(n);
  for (const p of subjectIdx) {
    const y = (0.2126 * R[p]! + 0.7152 * G[p]! + 0.0722 * B[p]!) * exposureGain;
    L[p] = yToL(Math.min(1, y));
  }
  for (const p of subjectIdx) {
    const lifted = shadowLiftL(L[p]!, opt.shadowLift, opt.shadowThreshold);
    if (lifted !== L[p]) {
      const scale = L[p]! > 0 ? lToY(lifted) / lToY(L[p]!) : 0;
      if (scale > 0) {
        R[p]! *= scale;
        G[p]! *= scale;
        B[p]! *= scale;
      }
      L[p] = lifted;
    }
  }

  // 4 — sharpening, last, on lightness only.
  const sharpened =
    opt.sharpenAmount > 0 ? unsharpL(L, isSubject, width, height, opt.sharpenAmount) : L;

  for (const p of subjectIdx) {
    let scale = exposureGain;
    if (sharpened[p] !== L[p]) {
      const before = lToY(Math.max(0, Math.min(100, L[p]!)));
      const after = lToY(Math.max(0, Math.min(100, sharpened[p]!)));
      if (before > 0) scale *= after / before;
    }
    out[p * 4] = linearToSrgbByte(R[p]! * scale);
    out[p * 4 + 1] = linearToSrgbByte(G[p]! * scale);
    out[p * 4 + 2] = linearToSrgbByte(B[p]! * scale);
  }

  return {
    rgba: out,
    params: { wbGains, exposureGain, shadowLift: opt.shadowLift, sharpenAmount: opt.sharpenAmount }
  };
}
