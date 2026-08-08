/* The single derive pipeline: base buffers + ops → corrected subject + crop.
 * Both the editing preview and the export run through here, so what you see
 * is what you save — recompute() and the exporter cannot drift apart. */

import { ALPHA_THRESHOLD, alphaBBox, padBBox, type BBox } from './cutout';
import { applyEditDiff, computeEditDiff, replayOps, type Op } from './editor';
import { correctLighting } from './lighting';

export interface BaseBuffers {
  width: number;
  height: number;
  /** Original photo RGBA at this resolution. Never modified. */
  origRgba: Uint8ClampedArray;
  /** The segmentation API's mask at this resolution. */
  baseAlpha: Uint8Array;
}

export interface DerivedView {
  alpha: Uint8Array;
  /** Lighting-corrected subject RGBA (alpha = effective mask). */
  corrected: Uint8ClampedArray;
  crop: BBox;
}

/** Effective mask at the editing resolution (the canonical one for ops). */
export function editAlpha(base: BaseBuffers, ops: Op[]): Uint8Array {
  return replayOps(base.baseAlpha, base.width, base.height, ops);
}

/** Effective mask at any other resolution: the user's edits, captured at the
 * editing resolution, projected onto this resolution's base mask. */
export function projectedAlpha(editBase: BaseBuffers, ops: Op[], target: BaseBuffers): Uint8Array {
  const diff = computeEditDiff(editBase.baseAlpha, editBase.width, editBase.height, ops);
  return applyEditDiff(
    target.baseAlpha,
    target.width,
    target.height,
    diff,
    editBase.width,
    editBase.height
  );
}

/** Correct lighting under the effective mask and crop to the subject.
 * `subjectScratch` (original colours, length w*h*4) is reused when given —
 * only its alpha bytes are rewritten. */
export function deriveView(
  base: BaseBuffers,
  alpha: Uint8Array,
  subjectScratch?: Uint8ClampedArray
): DerivedView {
  const subject = subjectScratch ?? new Uint8ClampedArray(base.origRgba);
  for (let p = 0; p < alpha.length; p++) subject[p * 4 + 3] = alpha[p]!;
  const { rgba: corrected } = correctLighting(subject, base.origRgba, base.width, base.height);
  const box = alphaBBox(corrected, base.width, base.height, ALPHA_THRESHOLD);
  const crop = box
    ? padBBox(box, base.width, base.height)
    : { x0: 0, y0: 0, x1: base.width, y1: base.height };
  return { alpha, corrected, crop };
}
