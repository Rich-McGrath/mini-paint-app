/* Colour maths ported from the archived value-check.html prototype (tested there;
 * reuse, don't re-derive — see README). sRGB → linear → luminance Y → CIE L*, and back.
 * Key verification: L* 50 is sRGB byte 119 (#777777), not 128 — the naive-desaturation error.
 */

/** sRGB byte (0–255) → linear-light component (0–1). */
export const SRGB_TO_LINEAR: Float32Array = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

/** Relative luminance Y (0–1) from linear RGB components. */
export function luminance(rLin: number, gLin: number, bLin: number): number {
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/** Luminance Y (0–1) → CIE L* (0–100 perceptual lightness). */
export const yToL = (Y: number): number => (Y <= 0.008856 ? Y * 903.3 : 116 * Math.cbrt(Y) - 16);

/** CIE L* (0–100) → luminance Y (0–1). */
export const lToY = (L: number): number => (L <= 8 ? L / 903.3 : Math.pow((L + 16) / 116, 3));

/** Linear-light component (0–1) → sRGB byte (0–255). */
export function linearToSrgbByte(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** Fast linear→sRGB byte via a 4096-entry LUT — error under 1/255, monotonic.
 * For per-pixel hot paths; linearToSrgbByte stays the exact reference. */
export const LINEAR_TO_BYTE: Uint8Array = (() => {
  const lut = new Uint8Array(4097);
  for (let i = 0; i <= 4096; i++) lut[i] = linearToSrgbByte(i / 4096);
  return lut;
})();

export function linearToSrgbByteFast(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 255;
  return LINEAR_TO_BYTE[Math.round(c * 4096)]!;
}

/** Integer CIE L* (0–100) → the grey sRGB byte with that lightness. */
export const L_TO_BYTE: Uint8Array = (() => {
  const lut = new Uint8Array(101);
  for (let L = 0; L <= 100; L++) lut[L] = linearToSrgbByte(lToY(L));
  return lut;
})();

/** CIE L* (0–100) of one sRGB pixel. */
export function srgbToL(r: number, g: number, b: number): number {
  return yToL(luminance(SRGB_TO_LINEAR[r]!, SRGB_TO_LINEAR[g]!, SRGB_TO_LINEAR[b]!));
}
