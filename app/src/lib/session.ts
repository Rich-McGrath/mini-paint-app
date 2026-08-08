/* Optional sign-in via Supabase magic link — hand-rolled REST, no SDK weight.
 * The flow: request an email OTP link → Supabase redirects back with tokens in
 * the URL hash → adopt and store them. The Worker validates the access token
 * server-side; signed-out use stays first-class with the anonymous id.
 *
 * Requires build-time config (client-safe by design — this is the publishable
 * key, not the secret): VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.
 * When absent, sign-in UI is hidden entirely. */

const KEY = 'ss-session';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const authAvailable = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);

export interface Session {
  accessToken: string;
  refreshToken?: string;
}

/** Parse Supabase's redirect hash: '#access_token=…&refresh_token=…&…'. Pure. */
export function parseAuthHash(hash: string): Session | null {
  if (!hash.startsWith('#')) return null;
  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  if (!accessToken) return null;
  return { accessToken, refreshToken: params.get('refresh_token') ?? undefined };
}

/** Adopt a magic-link redirect if present; returns true when one was found. */
export function adoptSessionFromUrl(): boolean {
  const session = parseAuthHash(window.location.hash);
  if (!session) return false;
  localStorage.setItem(KEY, JSON.stringify(session));
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return true;
}

export function currentSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function signOut(): void {
  localStorage.removeItem(KEY);
}

export async function requestMagicLink(email: string): Promise<void> {
  if (!authAvailable) throw new Error('sign-in is not configured');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      create_user: true,
      options: { email_redirect_to: window.location.origin }
    })
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { msg?: string; error?: string } | null;
    throw new Error(body?.msg ?? body?.error ?? "Couldn't send the sign-in email.");
  }
}
