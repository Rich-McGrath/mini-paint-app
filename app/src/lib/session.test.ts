import { describe, expect, it } from 'vitest';
import { parseAuthHash } from './session';

describe('parseAuthHash', () => {
  it('extracts tokens from a magic-link redirect', () => {
    const s = parseAuthHash('#access_token=abc.def.ghi&refresh_token=r123&token_type=bearer&type=magiclink');
    expect(s).toEqual({ accessToken: 'abc.def.ghi', refreshToken: 'r123' });
  });

  it('handles a missing refresh token', () => {
    expect(parseAuthHash('#access_token=t')).toEqual({ accessToken: 't', refreshToken: undefined });
  });

  it('returns null for ordinary or empty hashes', () => {
    expect(parseAuthHash('')).toBeNull();
    expect(parseAuthHash('#section-2')).toBeNull();
    expect(parseAuthHash('#error=access_denied&error_description=expired')).toBeNull();
  });
});
