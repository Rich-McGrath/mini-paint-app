/* API client. Same-origin (/api) — the Worker serves both the app and the API. */

const USER_KEY = 'ss-user-id';

/** Anonymous user id, stored from day one (SPEC §5). Replaced by the auth id in M4. */
export function userId(): string {
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

async function ok(res: Response): Promise<Response> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `request failed (${res.status})`);
  }
  return res;
}

export async function uploadImage(file: File): Promise<string> {
  const res = await ok(
    await fetch('/api/images', {
      method: 'POST',
      headers: { 'content-type': file.type, 'x-user-id': userId() },
      body: file
    })
  );
  return ((await res.json()) as { id: string }).id;
}

export async function segmentImage(id: string): Promise<void> {
  await ok(await fetch(`/api/images/${id}/segment`, { method: 'POST' }));
}

export async function fetchCutout(id: string): Promise<Blob> {
  const res = await ok(await fetch(`/api/images/${id}/cutout`));
  return res.blob();
}

export async function fetchOriginal(id: string): Promise<Blob> {
  const res = await ok(await fetch(`/api/images/${id}/original`));
  return res.blob();
}
