import { describe, expect, it } from 'vitest';
import { alphaBBox, padBBox } from './cutout';

function image(width: number, height: number, opaque: Array<[number, number]>): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of opaque) rgba[(y * width + x) * 4 + 3] = 255;
  return rgba;
}

describe('alphaBBox', () => {
  it('finds the tight box around opaque pixels', () => {
    const rgba = image(10, 8, [
      [2, 1],
      [5, 4],
      [3, 6]
    ]);
    expect(alphaBBox(rgba, 10, 8)).toEqual({ x0: 2, y0: 1, x1: 6, y1: 7 });
  });

  it('returns null for a fully transparent image', () => {
    expect(alphaBBox(image(4, 4, []), 4, 4)).toBeNull();
  });

  it('ignores alpha at or below the threshold', () => {
    const rgba = image(4, 4, [[1, 1]]);
    rgba[(2 * 4 + 3) * 4 + 3] = 8; // at threshold — ignored
    expect(alphaBBox(rgba, 4, 4)).toEqual({ x0: 1, y0: 1, x1: 2, y1: 2 });
  });

  it('spans the full image when everything is opaque', () => {
    const rgba = new Uint8ClampedArray(6 * 5 * 4).fill(255);
    expect(alphaBBox(rgba, 6, 5)).toEqual({ x0: 0, y0: 0, x1: 6, y1: 5 });
  });
});

describe('padBBox', () => {
  it('pads by a fraction of the longer side', () => {
    const padded = padBBox({ x0: 20, y0: 20, x1: 70, y1: 120 }, 200, 200, 0.1);
    expect(padded).toEqual({ x0: 10, y0: 10, x1: 80, y1: 130 });
  });

  it('clamps to the image bounds', () => {
    const padded = padBBox({ x0: 0, y0: 0, x1: 100, y1: 100 }, 100, 100, 0.1);
    expect(padded).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 });
  });
});
