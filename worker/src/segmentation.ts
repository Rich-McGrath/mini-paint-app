/* Segmentation lives behind this interface so the vendor is a config change,
 * not a rewrite (PLAN.md §1). The provider returns a cutout PNG whose alpha
 * channel IS the mask — the client composites and crops from it. */

export interface SegmentationResult {
  /** RGBA PNG, same content as the input with background pixels transparent. */
  cutoutPng: Uint8Array;
  /** Provider + model identifier, stored with the record for the bake-off and the flywheel. */
  model: string;
}

export interface SegmentationProvider {
  readonly name: string;
  segment(imageBytes: Uint8Array, contentType: string): Promise<SegmentationResult>;
}

/** Development/test stand-in: returns the input unchanged (keeps everything). */
export class MockProvider implements SegmentationProvider {
  readonly name = 'mock';
  segment(imageBytes: Uint8Array): Promise<SegmentationResult> {
    return Promise.resolve({ cutoutPng: imageBytes, model: 'mock/identity' });
  }
}

/** fal.ai queue API — the plumbing proven in the previous app (server-only FAL_KEY).
 * Default model is BiRefNet v2; the M2 bake-off may swap MODEL via config. */
export class FalProvider implements SegmentationProvider {
  readonly name = 'fal';
  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'fal-ai/birefnet/v2'
  ) {}

  async segment(imageBytes: Uint8Array, contentType: string): Promise<SegmentationResult> {
    const submit = await this.falFetch(`https://queue.fal.run/${this.model}`, {
      method: 'POST',
      body: JSON.stringify({ image_url: toDataUri(imageBytes, contentType) })
    });
    const { status_url, response_url } = submit as { status_url: string; response_url: string };

    const deadline = Date.now() + 90_000;
    for (;;) {
      const status = (await this.falFetch(status_url)) as { status: string };
      if (status.status === 'COMPLETED') break;
      if (status.status === 'FAILED') throw new Error(`fal.ai request failed (${this.model})`);
      if (Date.now() > deadline) throw new Error(`fal.ai request timed out (${this.model})`);
      await new Promise((r) => setTimeout(r, 600));
    }

    const result = (await this.falFetch(response_url)) as { image?: { url?: string } };
    if (!result.image?.url) throw new Error(`fal.ai returned no image (${this.model})`);
    const png = await fetch(result.image.url);
    if (!png.ok) throw new Error(`fal.ai image fetch failed: ${png.status}`);
    return { cutoutPng: new Uint8Array(await png.arrayBuffer()), model: this.model };
  }

  private async falFetch(url: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init?.headers
      }
    });
    if (!res.ok) throw new Error(`fal.ai ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

function toDataUri(bytes: Uint8Array, contentType: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}
