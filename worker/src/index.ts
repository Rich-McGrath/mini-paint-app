import type { Context } from 'hono';
import { Hono } from 'hono';
import { resolveUser } from './auth';
import {
  claimUsername,
  countImagesToday,
  createImage,
  deleteImage,
  getImage,
  getUsername,
  updateImage,
  type ImageRecord
} from './db';
import { FalProvider, MockProvider, type SegmentationProvider } from './segmentation';

export type Env = {
  IMAGES: R2Bucket;
  ASSETS?: Fetcher;
  FAL_KEY?: string;
  FAL_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  SEGMENTATION_PROVIDER?: 'fal' | 'mock';
  /** Per-user uploads per UTC day; unset or "0" = unlimited. Every upload is
   * one paid segmentation, so this is the free-tier lever (SPEC §11). */
  DAILY_UPLOAD_LIMIT?: string;
};

/* The client normalises uploads to ≤2048px JPEG (well under 2MB); this cap
 * bounds direct API callers and the base64 blow-up in the fal submission. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function provider(env: Env): SegmentationProvider {
  if (env.SEGMENTATION_PROVIDER === 'fal') {
    if (!env.FAL_KEY) throw new Error('SEGMENTATION_PROVIDER=fal but FAL_KEY is not set');
    return new FalProvider(env.FAL_KEY, env.FAL_MODEL);
  }
  return new MockProvider();
}

const app = new Hono<{ Bindings: Env }>().basePath('/api');

type Ctx = Context<{ Bindings: Env }>;

/** The caller's identity: authenticated id when a valid token is presented,
 * anonymous x-user-id otherwise. */
async function callerId(c: Ctx): Promise<string | null> {
  const authed = await resolveUser(c.env, c.req.header('authorization'));
  return authed?.id ?? c.req.header('x-user-id') ?? null;
}

/** Every per-image route requires the caller to own the record. A mismatch is
 * a 404, not a 403 — image ids are unguessable and existence is not disclosed. */
async function ownedImage(c: Ctx): Promise<ImageRecord | null> {
  const record = await getImage(c.env, c.req.param('id') ?? '');
  if (!record) return null;
  const caller = await callerId(c);
  return caller === record.user_id ? record : null;
}

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
  if (length > MAX_UPLOAD_BYTES) return c.json({ error: 'image too large (8MB max)' }, 413);
  const userId = await callerId(c);
  if (!userId) return c.json({ error: 'missing x-user-id header' }, 400);

  const limit = Number(c.env.DAILY_UPLOAD_LIMIT ?? '0');
  if (limit > 0 && (await countImagesToday(c.env, userId)) >= limit) {
    return c.json(
      { error: `That's the ${limit} photos for today — more tomorrow.` },
      429
    );
  }

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: 'empty body' }, 400);
  if (bytes.length > MAX_UPLOAD_BYTES) return c.json({ error: 'image too large (8MB max)' }, 413);

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
    training_key: null,
    provider: null,
    status: 'uploaded',
    created_at: new Date().toISOString()
  });
  return c.json({ id }, 201);
});

/* Run segmentation on a stored original. Synchronous: the walking skeleton waits;
 * if vendor latency warrants it, this can split into submit + poll. */
app.post('/images/:id/segment', async (c) => {
  const record = await ownedImage(c);
  if (!record) return c.json({ error: 'not found' }, 404);
  const id = record.id;

  // Idempotent: each image pays for segmentation once. Re-calls return the
  // existing result instead of spending another vendor credit.
  if (record.cutout_key) {
    return c.json({ id, status: record.status, model: record.provider, cached: true });
  }

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
  const record = await ownedImage(c);
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
  const record = await ownedImage(c);
  if (!record) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.IMAGES.get(record.original_key);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: { 'content-type': record.original_type, 'cache-control': 'private, max-age=3600' }
  });
});

app.get('/images/:id/cutout', async (c) => {
  const record = await ownedImage(c);
  if (!record?.cutout_key) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.IMAGES.get(record.cutout_key);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' }
  });
});

/* The flywheel: a user-corrected mask, downscaled client-side (SPEC §9 — every
 * correction is a human-verified mask). The paired downscaled image is copied
 * out of originals/ so the training pair survives original-retention expiry. */
app.post('/images/:id/mask', async (c) => {
  const record = await ownedImage(c);
  if (!record) return c.json({ error: 'not found' }, 404);
  const id = record.id;
  if (!(c.req.header('content-type') ?? '').startsWith('image/png')) {
    return c.json({ error: 'mask must be a PNG' }, 415);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json({ error: 'empty body' }, 400);
  if (bytes.length > MAX_UPLOAD_BYTES) return c.json({ error: 'mask too large' }, 413);

  const maskKey = `masks/${id}.png`;
  await c.env.IMAGES.put(maskKey, bytes, { httpMetadata: { contentType: 'image/png' } });

  let trainingKey = record.training_key;
  if (!trainingKey) {
    const original = await c.env.IMAGES.get(record.original_key);
    if (original) {
      trainingKey = `training/${id}`;
      await c.env.IMAGES.put(trainingKey, original.body, {
        httpMetadata: { contentType: record.original_type }
      });
    }
  }
  await updateImage(c.env, id, {
    corrected_mask_key: maskKey,
    training_key: trainingKey ?? null,
    status: 'corrected'
  });
  return c.json({ id, status: 'corrected' });
});

/* Terms promise deletion at any time; this is the code path that honours it. */
app.delete('/images/:id', async (c) => {
  const record = await ownedImage(c);
  if (!record) return c.json({ error: 'not found' }, 404);
  const keys = [
    record.original_key,
    record.cutout_key,
    record.corrected_mask_key,
    record.training_key
  ].filter((k): k is string => Boolean(k));
  await Promise.all(keys.map((k) => c.env.IMAGES.delete(k)));
  await deleteImage(c.env, record.id);
  return c.json({ deleted: true });
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
