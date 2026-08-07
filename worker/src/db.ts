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
  provider: string | null;
  status: 'uploaded' | 'cutout' | 'corrected';
  created_at: string;
}

const memory = new Map<string, ImageRecord>();

function configured(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

async function rest(env: Env, path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY!,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers
    }
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
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
  if (!configured(env)) return memory.get(id) ?? null;
  const res = await rest(env, `images?id=eq.${encodeURIComponent(id)}`, { method: 'GET' });
  const rows = (await res.json()) as ImageRecord[];
  return rows[0] ?? null;
}

export async function updateImage(env: Env, id: string, patch: Partial<ImageRecord>): Promise<void> {
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
