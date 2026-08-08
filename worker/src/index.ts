import { Hono } from 'hono';
import { resolveUser } from './auth';
import { claimUsername, createImage, getImage, getUsername, updateImage } from './db';
import { FalProvider, MockProvider, type SegmentationProvider } from './segmentation';

export type Env = {
  IMAGES: R2Bucket;
  ASSETS?: Fetcher;
  FAL_KEY?: string;
  FAL_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  SEGMENTATION_PROVIDER?: 'fal' | 'mock';
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function provider(env: Env): SegmentationProvider {
  if (env.SEGMENTATION_PROVIDER === 'fal') {
    if (!env.FAL_KEY) throw new Error('SEGMENTATION_PROVIDER=fal but FAL_KEY is not set');
    return new FalProvider(env.FAL_KEY, env.FAL_MODEL);
  }
  return new MockProvider();
}

const app = new Hono<{ Bindings: Env }>().basePath('/api');

/* Surface the real failure: log it for `wrangler tail` and return the message
 * so the client can show something actionable instead of a bare 500. */
app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: err instanceof Error ? err.message : 'internal error' }, 500);
});

app.get('/health', (c) => c.json({ ok: true, service: 'studioshot-api' }));

/* Upload the original. Body is the raw image; the anonymous or signed-in user id
 * travels in x-user-id and is stored from day one (SPEC §5). */
app.post('/images', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    return c.json({ error: 'body must be an image' }, 400);
  }
  const length = Number(c.req.header('content-length') ?? '0');
  if (length > MAX_UPLOAD_BYTES) return c.json({ error: 'image too large (20MB max)' }, 413);
  // Signed-in id when a valid token is presented; anonymous id otherwise.
  const authed = await resolveUser(c.env, c.req.header('authorization'));
  const userId = authed?.id ?? c.req.header('x-user-id');
  if (!userId) return c.json({ error: 'missing x-user-id header' }, 400);

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: 'empty body' }, 400);
  if (bytes.length > MAX_UPLOAD_BYTES) return c.json({ error: 'image too large (20MB max)' }, 413);

  const id = crypto.randomUUID();
  const originalKey = `originals/${id}`;
  await c.env.IMAGES.put(originalKey, bytes, { httpMetadata: { contentType } });
  await createImage(c.env, {
    id,
    user_id: userId,
    kit_tag: null,
    original_key: originalKey,
    original_type: contentType,
    cutout_key: null,
    corrected_mask_key: null,
    provider: null,
    status: 'uploaded',
    created_at: new Date().toISOString()
  });
  return c.json({ id }, 201);
});

/* Run segmentation on a stored original. Synchronous: the walking skeleton waits;
 * if vendor latency warrants it, M2 can split this into submit + poll. */
app.post('/images/:id/segment', async (c) => {
  const id = c.req.param('id');
  const record = await getImage(c.env, id);
  if (!record) return c.json({ error: 'not found' }, 404);

  const original = await c.env.IMAGES.get(record.original_key);
  if (!original) return c.json({ error: 'original missing from storage' }, 500);

  const seg = provider(c.env);
  const result = await seg.segment(
    new Uint8Array(await original.arrayBuffer()),
    record.original_type
  );

  const cutoutKey = `cutouts/${id}.png`;
  await c.env.IMAGES.put(cutoutKey, result.cutoutPng, {
    httpMetadata: { contentType: 'image/png' }
  });
  await updateImage(c.env, id, { cutout_key: cutoutKey, provider: result.model, status: 'cutout' });
  return c.json({ id, status: 'cutout', model: result.model });
});

app.get('/images/:id', async (c) => {
  const record = await getImage(c.env, c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  return c.json({
    id: record.id,
    status: record.status,
    provider: record.provider,
    original: `/api/images/${record.id}/original`,
    cutout: record.cutout_key ? `/api/images/${record.id}/cutout` : null
  });
});

app.get('/images/:id/original', async (c) => {
  const record = await getImage(c.env, c.req.param('id'));
  if (!record) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.IMAGES.get(record.original_key);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: { 'content-type': record.original_type, 'cache-control': 'private, max-age=3600' }
  });
});

app.get('/images/:id/cutout', async (c) => {
  const record = await getImage(c.env, c.req.param('id'));
  if (!record?.cutout_key) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.IMAGES.get(record.cutout_key);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' }
  });
});

/* The flywheel: a user-corrected mask, downscaled client-side. Stored verbatim;
 * every correction is a human-verified mask (SPEC §9). */
app.post('/images/:id/mask', async (c) => {
  const id = c.req.param('id');
  const record = await getImage(c.env, id);
  if (!record) return c.json({ error: 'not found' }, 404);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: 'empty body' }, 400);
  if (bytes.length > MAX_UPLOAD_BYTES) return c.json({ error: 'mask too large' }, 413);
  const maskKey = `masks/${id}.png`;
  await c.env.IMAGES.put(maskKey, bytes, { httpMetadata: { contentType: 'image/png' } });
  await updateImage(c.env, id, { corrected_mask_key: maskKey, status: 'corrected' });
  return c.json({ id, status: 'corrected' });
});

/* Signed-in state for the client to restore on load. */
app.get('/me', async (c) => {
  const user = await resolveUser(c.env, c.req.header('authorization'));
  if (!user) return c.json({ error: 'not signed in' }, 401);
  return c.json({ userId: user.id, email: user.email, username: await getUsername(c.env, user.id) });
});

/* Username reservation (SPEC §5): unique forever, claimable at sign-up. */
app.post('/username', async (c) => {
  const user = await resolveUser(c.env, c.req.header('authorization'));
  if (!user) return c.json({ error: 'sign in first' }, 401);
  const { username } = (await c.req.json().catch(() => ({}))) as { username?: string };
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return c.json({ error: 'usernames are 3–20 letters, numbers or underscores' }, 400);
  }
  const claimed = await claimUsername(c.env, user.id, username);
  if (!claimed) return c.json({ error: 'that username is taken' }, 409);
  return c.json({ username });
});

export default app;
