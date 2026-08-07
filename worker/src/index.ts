import { Hono } from 'hono';

// M1 adds: IMAGES: R2Bucket; FAL_KEY: string; SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string
export type Env = Record<string, never>;

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true, service: 'studioshot-api' }));

/* M1 routes:
 *   POST /uploads    → presigned R2 PUT + image record
 *   POST /segment    → SegmentationProvider → mask to R2
 *   GET  /images/:id → record + signed URLs
 *   POST /masks/:id  → user-corrected mask (the flywheel)
 */

export default app;
