/* API client. Same-origin (/api) — the Worker serves both the app and the API. */

import { normalizeForUpload } from './normalize';
import { currentSession } from './session';

const USER_KEY = 'ss-user-id';

/** Anonymous user id, stored from day one (SPEC §5). A signed-in request also
 * carries the auth token; the Worker prefers the authenticated id. */
export function userId(): string {
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

/** Every image route is ownership-checked server-side, so every call carries
 * the caller's identity: anonymous id always, auth token when signed in. */
function identityHeaders(): Record<string, string> {
  const session = currentSession();
  return {
    'x-user-id': userId(),
    ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {})
  };
}

async function ok(res: Response): Promise<Response> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `request failed (${res.status})`);
  }
  return res;
}

export async function uploadImage(file: File): Promise<string> {
  const jpeg = await normalizeForUpload(file);
  const res = await ok(
    await fetch('/api/images', {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', ...identityHeaders() },
      body: jpeg
    })
  );
  return ((await res.json()) as { id: string }).id;
}

/** Segmentation can sit in a vendor queue; give it long rope but not forever. */
export async function segmentImage(id: string): Promise<void> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 120_000);
  try {
    await ok(
      await fetch(`/api/images/${id}/segment`, {
        method: 'POST',
        headers: identityHeaders(),
        signal: abort.signal
      })
    );
  } catch (err) {
    if (abort.signal.aborted) {
      throw new Error('This is taking longer than it should. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCutout(id: string): Promise<Blob> {
  const res = await ok(await fetch(`/api/images/${id}/cutout`, { headers: identityHeaders() }));
  return res.blob();
}

export async function fetchOriginal(id: string): Promise<Blob> {
  const res = await ok(await fetch(`/api/images/${id}/original`, { headers: identityHeaders() }));
  return res.blob();
}

/** The flywheel: a user-corrected mask, downscaled. Fire-and-forget quality —
 * failures must never interrupt the user's download. */
export async function uploadMask(id: string, maskPng: Blob): Promise<void> {
  await ok(
    await fetch(`/api/images/${id}/mask`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', ...identityHeaders() },
      body: maskPng
    })
  );
}

/** Deletion, promised by the terms: removes the record and every stored object. */
export async function deleteImage(id: string): Promise<void> {
  await ok(await fetch(`/api/images/${id}`, { method: 'DELETE', headers: identityHeaders() }));
}

export interface Me {
  userId: string;
  email: string | null;
  username: string | null;
}

export async function fetchMe(): Promise<Me | null> {
  const session = currentSession();
  if (!session) return null;
  // Offline or unreachable is "not signed in right now", never an exception —
  // this runs unawaited at boot.
  try {
    const res = await fetch('/api/me', { headers: identityHeaders() });
    if (!res.ok) return null; // expired token → treat as signed out
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}

export async function claimUsername(username: string): Promise<void> {
  await ok(
    await fetch('/api/username', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...identityHeaders() },
      body: JSON.stringify({ username })
    })
  );
}
