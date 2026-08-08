/* Resolution policy in one place — these two are coupled: uploads are capped
 * at the export resolution because nothing beyond it is ever used, so raising
 * one without the other silently produces upscaled-blurry exports. */

/** Upload normalisation and export resolution (long side, px). */
export const WORKING_DIM = 2048;

/** Interactive editing resolution (long side, px) — the canonical resolution
 * for edit ops (see editor.ts). */
export const EDIT_DIM = 1280;
