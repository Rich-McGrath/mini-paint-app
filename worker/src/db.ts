/* Image records in Supabase Postgres via PostgREST — plain fetch, no SDK (leanness).
 * When SUPABASE_URL is unset (local dev, tests) records live in an in-memory map,
 * which is per-isolate and fine for development only. */

import type { Env } from './index';

export interface ImageRecord {
  id: string;
  user_id: string;
  kit_tag: string | null;
  original_key: string;
  original_type: string;
  cutout_key: string | null;
  corrected_mask_key: string | null;
  training_key: string | null; // downscaled image copy kept with the corrected mask
  provider: string | null;
  status: 'uploaded' | 'cutout' | 'corrected';
  created_at: string;
}

const memory = new Map<string, ImageRecord>();
const memoryUsernames = new Map<string, string>(); // user_id → username

function configured(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

/* Path params flow into uuid-column filters; PostgREST answers 400 for
 * malformed uuids, which must surface as not-found, not a 500. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rest(
  env: Env,
  path: string,
  init: RequestInit,
  tolerated: number[] = []
): Promise<Response> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY!,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers
    }
  });
  if (!res.ok && !tolerated.includes(res.status)) {
    throw new Error(`supabase ${res.status}: ${await res.text()}`);
  }
  return res;
}

export async function createImage(env: Env, record: ImageRecord): Promise<void> {
  if (!configured(env)) {
    memory.set(record.id, record);
    return;
  }
  await rest(env, 'images', { method: 'POST', body: JSON.stringify(record) });
}

export async function getImage(env: Env, id: string): Promise<ImageRecord | null> {
  if (!UUID_RE.test(id)) return null;
  if (!configured(env)) return memory.get(id) ?? null;
  const res = await rest(env, `images?id=eq.${encodeURIComponent(id)}`, { method: 'GET' });
  const rows = (await res.json()) as ImageRecord[];
  return rows[0] ?? null;
}

export async function deleteImage(env: Env, id: string): Promise<void> {
  if (!UUID_RE.test(id)) return;
  if (!configured(env)) {
    memory.delete(id);
    return;
  }
  await rest(env, `images?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function updateImage(env: Env, id: string, patch: Partial<ImageRecord>): Promise<void> {
  if (!UUID_RE.test(id)) return;
  if (!configured(env)) {
    const existing = memory.get(id);
    if (existing) memory.set(id, { ...existing, ...patch });
    return;
  }
  await rest(env, `images?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

export async function getUsername(env: Env, userId: string): Promise<string | null> {
  if (!configured(env)) return memoryUsernames.get(userId) ?? null;
  const res = await rest(env, `usernames?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'GET'
  });
  const rows = (await res.json()) as Array<{ username: string }>;
  return rows[0]?.username ?? null;
}

/** Reserve (or change) the username. Returns false when the name is taken. */
export async function claimUsername(env: Env, userId: string, username: string): Promise<boolean> {
  if (!configured(env)) {
    for (const [uid, name] of memoryUsernames) {
      if (name.toLowerCase() === username.toLowerCase() && uid !== userId) return false;
    }
    memoryUsernames.set(userId, username);
    return true;
  }
  const res = await rest(
    env,
    'usernames?on_conflict=user_id',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: userId, username })
    },
    [409]
  );
  return res.ok; // 409 = unique violation: taken
}
