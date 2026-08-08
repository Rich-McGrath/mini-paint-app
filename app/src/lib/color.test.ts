import { describe, expect, it } from 'vitest';
import {
  L_TO_BYTE,
  lToY,
  linearToSrgbByte,
  linearToSrgbByteFast,
  SRGB_TO_LINEAR,
  srgbToL,
  yToL
} from './color';

describe('colour maths (ported from value-check.html — verified there)', () => {
  it('maps L* 50 to sRGB byte 119, not 128', () => {
    expect(L_TO_BYTE[50]).toBe(119);
  });

  it('agrees that #777777 (the mid-grey preview background) is perceptual middle', () => {
    expect(srgbToL(0x77, 0x77, 0x77)).toBeCloseTo(50, 0);
  });

  it('maps the extremes exactly', () => {
    expect(L_TO_BYTE[0]).toBe(0);
    expect(L_TO_BYTE[100]).toBe(255);
    expect(srgbToL(0, 0, 0)).toBe(0);
    expect(srgbToL(255, 255, 255)).toBeCloseTo(100, 5);
  });

  it('round-trips L* → Y → L* across the range', () => {
    for (let L = 0; L <= 100; L++) {
      expect(yToL(lToY(L))).toBeCloseTo(L, 4);
    }
  });

  it('round-trips sRGB byte → linear → byte exactly', () => {
    for (let b = 0; b < 256; b++) {
      expect(linearToSrgbByte(SRGB_TO_LINEAR[b]!)).toBe(b);
    }
  });

  it('fast LUT agrees with the exact conversion within one byte', () => {
    for (let i = 0; i <= 1000; i++) {
      const c = i / 1000;
      expect(Math.abs(linearToSrgbByteFast(c) - linearToSrgbByte(c))).toBeLessThanOrEqual(1);
    }
    expect(linearToSrgbByteFast(-0.5)).toBe(0);
    expect(linearToSrgbByteFast(1.5)).toBe(255);
  });

  it('is monotonic: more lightness never means a darker byte', () => {
    for (let L = 1; L <= 100; L++) {
      expect(L_TO_BYTE[L]!).toBeGreaterThanOrEqual(L_TO_BYTE[L - 1]!);
    }
  });
});
