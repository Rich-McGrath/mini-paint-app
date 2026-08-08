import { describe, expect, it } from 'vitest';
import app, { type Env } from './index';

/* In-memory R2 stub — just enough surface for the routes under test. */
function r2Stub(): R2Bucket {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    put: async (key: string, value: ArrayBuffer | Uint8Array, opts?: R2PutOptions) => {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      store.set(key, { bytes, contentType: opts?.httpMetadata && 'contentType' in opts.httpMetadata ? opts.httpMetadata.contentType : undefined });
      return null;
    },
    get: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        body: new Blob([new Uint8Array(entry.bytes)]).stream(),
        arrayBuffer: async () => entry.bytes.buffer.slice(0) as ArrayBuffer
      };
    }
  } as unknown as R2Bucket;
}

function env(): Env {
  return { IMAGES: r2Stub(), SEGMENTATION_PROVIDER: 'mock' } as Env;
}

const PHOTO = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]);

function upload(e: Env) {
  return app.request(
    '/api/images',
    {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', 'x-user-id': 'test-user' },
      body: PHOTO.slice()
    },
    e
  );
}

describe('walking skeleton', () => {
  it('uploads, segments, and serves the cutout end to end', async () => {
    const e = env();

    const created = await upload(e);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(id).toBeTruthy();

    const seg = await app.request(`/api/images/${id}/segment`, { method: 'POST' }, e);
    expect(seg.status).toBe(200);
    expect(await seg.json()).toMatchObject({ id, status: 'cutout', model: 'mock/identity' });

    const record = await app.request(`/api/images/${id}`, {}, e);
    expect(record.status).toBe(200);
    expect(await record.json()).toMatchObject({
      id,
      status: 'cutout',
      cutout: `/api/images/${id}/cutout`
    });

    const cutout = await app.request(`/api/images/${id}/cutout`, {}, e);
    expect(cutout.status).toBe(200);
    expect(cutout.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await cutout.arrayBuffer())).toEqual(PHOTO);
  });

  it('stores a corrected mask (the flywheel)', async () => {
    const e = env();
    const { id } = (await (await upload(e)).json()) as { id: string };

    const mask = await app.request(
      `/api/images/${id}/mask`,
      { method: 'POST', headers: { 'content-type': 'image/png' }, body: PHOTO.slice() },
      e
    );
    expect(mask.status).toBe(200);
    expect(await mask.json()).toMatchObject({ id, status: 'corrected' });
  });

  it('rejects non-image uploads and missing user ids', async () => {
    const e = env();
    const notImage = await app.request(
      '/api/images',
      { method: 'POST', headers: { 'content-type': 'text/plain', 'x-user-id': 'u' }, body: 'hi' },
      e
    );
    expect(notImage.status).toBe(400);

    const noUser = await app.request(
      '/api/images',
      { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: PHOTO.slice() },
      e
    );
    expect(noUser.status).toBe(400);
  });

  it('404s for unknown images', async () => {
    const e = env();
    const res = await app.request('/api/images/nope', {}, e);
    expect(res.status).toBe(404);
    const seg = await app.request('/api/images/nope/segment', { method: 'POST' }, e);
    expect(seg.status).toBe(404);
  });

  it('responds on /api/health', async () => {
    const res = await app.request('/api/health', {}, env());
    expect(res.status).toBe(200);
  });

  it('requires sign-in for /me and /username', async () => {
    const e = env();
    expect((await app.request('/api/me', {}, e)).status).toBe(401);
    const claim = await app.request(
      '/api/username',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'painter' })
      },
      e
    );
    expect(claim.status).toBe(401);
  });

  it('still accepts anonymous uploads with an invalid bearer token', async () => {
    const e = env();
    const res = await app.request(
      '/api/images',
      {
        method: 'POST',
        headers: {
          'content-type': 'image/jpeg',
          'x-user-id': 'anon-1',
          authorization: 'Bearer not-a-real-token'
        },
        body: PHOTO.slice()
      },
      e
    );
    expect(res.status).toBe(201); // no Supabase configured → auth resolves null → anon id
  });
});
