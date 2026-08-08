/* The correction editor's mask model — pure, no DOM, testable under Node.
 *
 * Corrections are non-destructive operations over the segmentation mask
 * (SPEC §4): the base alpha comes from the API's cutout, every user gesture is
 * an Op, and the effective mask is a deterministic replay. Undo pops an Op.
 * Coordinates and sizes are normalised (0–1 of image dimensions). The editing
 * resolution is canonical: edits are captured there as a per-pixel diff
 * (computeEditDiff) and projected onto other resolutions (applyEditDiff), so
 * the export always matches the preview. */

export type Op =
  | { kind: 'trim'; y: number } // everything below y (fraction of height) goes
  | { kind: 'tap'; x: number; y: number } // remove the connected region under the tap
  | { kind: 'brush'; mode: 'add' | 'erase'; radius: number; points: Array<[number, number]> };

import { ALPHA_THRESHOLD } from './cutout';

export { ALPHA_THRESHOLD };

/** Replay ops over a copy of the base alpha — at the editing resolution only.
 * The tap op's flood fill depends on pixel connectivity, which changes with
 * resolution, so replay at any other resolution is NOT equivalent; use
 * computeEditDiff/applyEditDiff to project edits onto another resolution's
 * base mask instead. */
export function replayOps(base: Uint8Array, width: number, height: number, ops: Op[]): Uint8Array {
  const alpha = Uint8Array.from(base);
  for (const op of ops) {
    if (op.kind === 'trim') applyTrim(alpha, width, height, op.y);
    else if (op.kind === 'tap') removeRegion(alpha, width, height, op.x, op.y);
    else applyBrush(alpha, width, height, op);
  }
  return alpha;
}

function applyTrim(alpha: Uint8Array, width: number, height: number, yFrac: number): void {
  const y0 = Math.max(0, Math.round(yFrac * height));
  alpha.fill(0, y0 * width);
}

/** Flood-clear the 4-connected opaque region containing the seed. No-op when
 * the seed lands on a transparent pixel. */
export function removeRegion(
  alpha: Uint8Array,
  width: number,
  height: number,
  xFrac: number,
  yFrac: number
): boolean {
  const sx = Math.min(width - 1, Math.max(0, Math.round(xFrac * width)));
  const sy = Math.min(height - 1, Math.max(0, Math.round(yFrac * height)));
  const seed = sy * width + sx;
  if (alpha[seed]! <= ALPHA_THRESHOLD) return false;
  const stack = [seed];
  alpha[seed] = 0;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % width;
    if (x > 0 && alpha[p - 1]! > ALPHA_THRESHOLD) {
      alpha[p - 1] = 0;
      stack.push(p - 1);
    }
    if (x < width - 1 && alpha[p + 1]! > ALPHA_THRESHOLD) {
      alpha[p + 1] = 0;
      stack.push(p + 1);
    }
    if (p >= width && alpha[p - width]! > ALPHA_THRESHOLD) {
      alpha[p - width] = 0;
      stack.push(p - width);
    }
    if (p < alpha.length - width && alpha[p + width]! > ALPHA_THRESHOLD) {
      alpha[p + width] = 0;
      stack.push(p + width);
    }
  }
  return true;
}

function applyBrush(
  alpha: Uint8Array,
  width: number,
  height: number,
  op: Extract<Op, { kind: 'brush' }>
): void {
  const value = op.mode === 'add' ? 255 : 0;
  const r = Math.max(1, op.radius * width);
  const step = Math.max(1, r / 2);
  const stamp = (fx: number, fy: number): void => {
    const cx = fx * width;
    const cy = fy * height;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(height - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) alpha[y * width + x] = value;
      }
    }
  };
  const pts = op.points;
  if (pts.length === 0) return;
  stamp(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const dist = Math.hypot((bx - ax) * width, (by - ay) * height);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let k = 1; k <= n; k++) {
      stamp(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    }
  }
}

/** Per-pixel effect of the ops at the editing resolution — the canonical
 * record of what the user changed. 0 = untouched, 1 = removed, 2 = added. */
export function computeEditDiff(
  base: Uint8Array,
  width: number,
  height: number,
  ops: Op[]
): Uint8Array {
  const replayed = replayOps(base, width, height, ops);
  const diff = new Uint8Array(base.length);
  for (let p = 0; p < base.length; p++) {
    if (replayed[p] === base[p]) continue;
    diff[p] = replayed[p]! <= ALPHA_THRESHOLD ? 1 : 2;
  }
  return diff;
}

/** Project an edit-resolution diff onto a base mask at any resolution. The
 * result matches the editing preview by construction — including tap
 * removals, whose flood-fill connectivity would differ if replayed natively
 * at the target resolution. Identity when resolutions match. */
export function applyEditDiff(
  base: Uint8Array,
  width: number,
  height: number,
  diff: Uint8Array,
  diffWidth: number,
  diffHeight: number
): Uint8Array {
  const alpha = Uint8Array.from(base);
  for (let y = 0; y < height; y++) {
    const dy = Math.min(diffHeight - 1, Math.floor((y * diffHeight) / height));
    for (let x = 0; x < width; x++) {
      const dx = Math.min(diffWidth - 1, Math.floor((x * diffWidth) / width));
      const code = diff[dy * diffWidth + dx];
      if (code === 1) alpha[y * width + x] = 0;
      else if (code === 2) alpha[y * width + x] = 255;
    }
  }
  return alpha;
}
