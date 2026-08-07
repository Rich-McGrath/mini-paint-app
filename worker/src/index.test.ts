import { describe, expect, it } from 'vitest';
import app from './index';

describe('worker', () => {
  it('responds on /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'studioshot-api' });
  });

  it('404s on unknown routes', async () => {
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
  });
});
