/* Segmentation lives behind this interface so the vendor is a config change,
 * not a rewrite (PLAN.md §1). M1 adds the fal.ai queue-API provider; the
 * bake-off (BiRefNet v2, BRIA RMBG-2.0) runs against the seven fixture photos. */

export interface SegmentationResult {
  /** Single-channel alpha mask, same dimensions as the input, PNG-encoded. */
  maskPng: Uint8Array;
  width: number;
  height: number;
  /** Provider + model identifier, stored with the mask for the bake-off and the flywheel. */
  model: string;
}

export interface SegmentationProvider {
  readonly name: string;
  segment(imageBytes: Uint8Array, contentType: string): Promise<SegmentationResult>;
}

/** M0/M1 development stand-in: a full-opacity mask (keeps everything). */
export class MockProvider implements SegmentationProvider {
  readonly name = 'mock';
  segment(): Promise<SegmentationResult> {
    return Promise.reject(new Error('MockProvider.segment: implemented in M1'));
  }
}
