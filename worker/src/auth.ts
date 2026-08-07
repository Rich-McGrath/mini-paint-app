/* Optional sign-in. The client holds a Supabase Auth access token (magic
 * link); the Worker validates it against Supabase's auth endpoint rather than
 * verifying JWTs itself — one fetch, no key-rotation coupling. Anonymous use
 * stays first-class: callers fall back to the x-user-id header. */

import type { Env } from './index';

export interface AuthedUser {
  id: string;
  email: string | null;
}

export async function resolveUser(
  env: Env,
  authorization: string | undefined
): Promise<AuthedUser | null> {
  if (!authorization?.startsWith('Bearer ') || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return null;
  }
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: authorization }
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string; email?: string };
  return user.id ? { id: user.id, email: user.email ?? null } : null;
}
