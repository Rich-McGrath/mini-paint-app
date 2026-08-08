import { describe, expect, it } from 'vitest';
import { removeRegion, replayOps, type Op } from './editor';

/** 8×8 mask with two separate 2×2 opaque blobs and an opaque bottom row. */
function testMask(): { alpha: Uint8Array; w: number; h: number } {
  const w = 8;
  const h = 8;
  const alpha = new Uint8Array(w * h);
  for (const [x, y] of [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2], // blob A
    [5, 4],
    [6, 4],
    [5, 5],
    [6, 5] // blob B
  ]) {
    alpha[y! * w + x!] = 255;
  }
  for (let x = 0; x < w; x++) alpha[7 * w + x] = 255; // bottom row (the "pot")
  return { alpha, w, h };
}

const opaqueCount = (a: Uint8Array) => a.reduce((n, v) => n + (v > 8 ? 1 : 0), 0);

describe('trim', () => {
  it('clears everything below the line and nothing above', () => {
    const { alpha, w, h } = testMask();
    const out = replayOps(alpha, w, h, [{ kind: 'trim', y: 7 / 8 }]);
    expect(opaqueCount(out)).toBe(8); // both blobs survive, pot row gone
    expect(out[7 * w + 3]).toBe(0);
    expect(out[1 * w + 1]).toBe(255);
  });

  it('does not mutate the base mask', () => {
    const { alpha, w, h } = testMask();
    const before = Uint8Array.from(alpha);
    replayOps(alpha, w, h, [{ kind: 'trim', y: 0 }]);
    expect(alpha).toEqual(before);
  });
});

describe('tap to remove', () => {
  it('removes only the tapped connected region', () => {
    const { alpha, w, h } = testMask();
    const out = replayOps(alpha, w, h, [{ kind: 'tap', x: 1.5 / 8, y: 1.5 / 8 }]);
    expect(out[1 * w + 1]).toBe(0); // blob A gone
    expect(out[4 * w + 5]).toBe(255); // blob B intact
    expect(out[7 * w + 0]).toBe(255); // pot row intact
  });

  it('is a no-op on a transparent pixel', () => {
    const { alpha, w, h } = testMask();
    const out = replayOps(alpha, w, h, [{ kind: 'tap', x: 4 / 8, y: 0 }]);
    expect(out).toEqual(alpha);
    expect(removeRegion(Uint8Array.from(alpha), w, h, 4 / 8, 0)).toBe(false);
  });
});

describe('brush', () => {
  it('erase clears a disc, add restores one', () => {
    const w = 16;
    const h = 16;
    const full = new Uint8Array(w * h).fill(255);
    const erased = replayOps(full, w, h, [
      { kind: 'brush', mode: 'erase', radius: 3 / 16, points: [[0.5, 0.5]] }
    ]);
    expect(erased[8 * w + 8]).toBe(0); // centre gone
    expect(erased[0]).toBe(255); // corner untouched
    const restored = replayOps(erased, w, h, [
      { kind: 'brush', mode: 'add', radius: 3 / 16, points: [[0.5, 0.5]] }
    ]);
    expect(restored[8 * w + 8]).toBe(255);
  });

  it('paints continuously along a fast stroke (interpolated segments)', () => {
    const w = 32;
    const h = 8;
    const none = new Uint8Array(w * h);
    const out = replayOps(none, w, h, [
      {
        kind: 'brush',
        mode: 'add',
        radius: 1.2 / 32,
        points: [
          [2 / 32, 0.5],
          [30 / 32, 0.5] // two distant points — the segment must fill between
        ]
      }
    ]);
    for (let x = 3; x < 29; x++) expect(out[4 * w + x], `x=${x}`).toBe(255);
  });
});

describe('replay semantics', () => {
  it('is deterministic and order-sensitive, and undo = replay without the last op', () => {
    const { alpha, w, h } = testMask();
    const ops: Op[] = [
      { kind: 'trim', y: 7 / 8 },
      { kind: 'tap', x: 1.5 / 8, y: 1.5 / 8 }
    ];
    const a = replayOps(alpha, w, h, ops);
    const b = replayOps(alpha, w, h, ops);
    expect(a).toEqual(b);

    const undone = replayOps(alpha, w, h, ops.slice(0, -1));
    expect(undone[1 * w + 1]).toBe(255); // tap undone: blob A back
    expect(undone[7 * w + 3]).toBe(0); // trim still applied
  });
});
