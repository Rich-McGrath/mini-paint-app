import { describe, expect, it } from 'vitest';
import app, { type Env } from './index';

/* In-memory R2 stub — just enough surface for the routes under test. */
function r2Stub(): R2Bucket {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    put: async (key: string, value: ArrayBuffer | Uint8Array | ReadableStream, opts?: R2PutOptions) => {
      let bytes: Uint8Array;
      if (value instanceof Uint8Array) bytes = value;
      else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
      else bytes = new Uint8Array(await new Response(value).arrayBuffer());
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
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    _store: store
  } as unknown as R2Bucket;
}

function env(): Env {
  return { IMAGES: r2Stub(), SEGMENTATION_PROVIDER: 'mock' } as Env;
}

const PHOTO = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]);
const AS_USER = { 'x-user-id': 'test-user' };

function upload(e: Env, user = 'test-user') {
  return app.request(
    '/api/images',
    {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', 'x-user-id': user },
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

    const seg = await app.request(
      `/api/images/${id}/segment`,
      { method: 'POST', headers: AS_USER },
      e
    );
    expect(seg.status).toBe(200);
    expect(await seg.json()).toMatchObject({ id, status: 'cutout', model: 'mock/identity' });

    const record = await app.request(`/api/images/${id}`, { headers: AS_USER }, e);
    expect(record.status).toBe(200);
    expect(await record.json()).toMatchObject({
      id,
      status: 'cutout',
      cutout: `/api/images/${id}/cutout`
    });

    const cutout = await app.request(`/api/images/${id}/cutout`, { headers: AS_USER }, e);
    expect(cutout.status).toBe(200);
    expect(cutout.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await cutout.arrayBuffer())).toEqual(PHOTO);
  });

  it('segmentation is idempotent — one vendor call per image', async () => {
    const e = env();
    const { id } = (await (await upload(e)).json()) as { id: string };
    const first = await app.request(
      `/api/images/${id}/segment`,
      { method: 'POST', headers: AS_USER },
      e
    );
    expect(((await first.json()) as { cached?: boolean }).cached).toBeUndefined();
    const second = await app.request(
      `/api/images/${id}/segment`,
      { method: 'POST', headers: AS_USER },
      e
    );
    expect(await second.json()).toMatchObject({ id, cached: true });
  });

  it('denies every per-image route to a different caller', async () => {
    const e = env();
    const { id } = (await (await upload(e)).json()) as { id: string };
    const other = { 'x-user-id': 'someone-else' };
    for (const [path, init] of [
      [`/api/images/${id}`, { headers: other }],
      [`/api/images/${id}/segment`, { method: 'POST', headers: other }],
      [`/api/images/${id}/original`, { headers: other }],
      [
        `/api/images/${id}/mask`,
        { method: 'POST', headers: { ...other, 'content-type': 'image/png' }, body: PHOTO.slice() }
      ],
      [`/api/images/${id}`, { method: 'DELETE', headers: other }]
    ] as const) {
      const res = await app.request(path, init as RequestInit, e);
      expect(res.status, `${init.method ?? 'GET'} ${path}`).toBe(404); // not 403: no existence leak
    }
  });

  it('stores a corrected mask plus the training image copy (the flywheel)', async () => {
    const e = env();
    const { id } = (await (await upload(e)).json()) as { id: string };

    const mask = await app.request(
      `/api/images/${id}/mask`,
      {
        method: 'POST',
        headers: { ...AS_USER, 'content-type': 'image/png' },
        body: PHOTO.slice()
      },
      e
    );
    expect(mask.status).toBe(200);
    expect(await mask.json()).toMatchObject({ id, status: 'corrected' });
    const store = (e.IMAGES as unknown as { _store: Map<string, unknown> })._store;
    expect(store.has(`masks/${id}.png`)).toBe(true);
    expect(store.has(`training/${id}`)).toBe(true);
  });

  it('rejects a non-PNG mask', async () => {
    const e = env();
    const { id } = (await (await upload(e)).json()) as { id: string };
    const res = await app.request(
      `/api/images/${id}/mask`,
      { method: 'POST', headers: { ...AS_USER, 'content-type': 'image/jpeg' }, body: PHOTO.slice() },
      e
    );
    expect(res.status).toBe(415);
  });

  it('deletes the record and every stored object', async () => {
    const e = env();
    const { id } = (await (await upload(e)).json()) as { id: string };
    await app.request(`/api/images/${id}/segment`, { method: 'POST', headers: AS_USER }, e);

    const del = await app.request(`/api/images/${id}`, { method: 'DELETE', headers: AS_USER }, e);
    expect(del.status).toBe(200);

    const store = (e.IMAGES as unknown as { _store: Map<string, unknown> })._store;
    expect(store.size).toBe(0);
    const gone = await app.request(`/api/images/${id}`, { headers: AS_USER }, e);
    expect(gone.status).toBe(404);
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

  it('404s for unknown and malformed image ids', async () => {
    const e = env();
    expect((await app.request('/api/images/nope', { headers: AS_USER }, e)).status).toBe(404);
    expect(
      (
        await app.request(
          '/api/images/00000000-0000-4000-8000-000000000000',
          { headers: AS_USER },
          e
        )
      ).status
    ).toBe(404);
  });

  it('responds on /api/health', async () => {
    const res = await app.request('/api/health', {}, env());
    expect(res.status).toBe(200);
  });

  it('enforces the daily upload limit per user when configured', async () => {
    const e = { ...env(), DAILY_UPLOAD_LIMIT: '2' } as Env;
    expect((await upload(e, 'limited-user')).status).toBe(201);
    expect((await upload(e, 'limited-user')).status).toBe(201);
    const third = await upload(e, 'limited-user');
    expect(third.status).toBe(429);
    expect(((await third.json()) as { error: string }).error).toContain('today');
    // other users are unaffected
    expect((await upload(e, 'someone-else')).status).toBe(201);
  });

  it('leaves uploads unlimited when the limit is unset or zero', async () => {
    const e = { ...env(), DAILY_UPLOAD_LIMIT: '0' } as Env;
    for (let i = 0; i < 5; i++) expect((await upload(e, 'heavy-user')).status).toBe(201);
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
