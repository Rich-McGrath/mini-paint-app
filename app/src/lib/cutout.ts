/* Pure cutout geometry — no DOM, testable under Node.
 * The cutout PNG's alpha channel is the mask; auto-crop is its bounding box. */

export interface BBox {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number; // exclusive
}

/** Bounding box of pixels whose alpha exceeds the threshold, or null if none do.
 * `rgba` is tightly packed RGBA, row-major, as from ImageData.data. */
export function alphaBBox(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 8
): BBox | null {
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  let found = false;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3]! > threshold) {
        found = true;
        if (x < x0) x0 = x;
        if (x >= x1) x1 = x + 1;
        if (y < y0) y0 = y;
        if (y >= y1) y1 = y + 1;
      }
    }
  }
  return found ? { x0, y0, x1, y1 } : null;
}

/** Expand a box by `frac` of its longer side, clamped to the image. */
export function padBBox(box: BBox, width: number, height: number, frac = 0.04): BBox {
  const pad = Math.round(Math.max(box.x1 - box.x0, box.y1 - box.y0) * frac);
  return {
    x0: Math.max(0, box.x0 - pad),
    y0: Math.max(0, box.y0 - pad),
    x1: Math.min(width, box.x1 + pad),
    y1: Math.min(height, box.y1 + pad)
  };
}
