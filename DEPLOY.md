# Deploying Studioshot

One Cloudflare Worker serves everything: the built SPA as static assets, and the API under
`/api`. Uploads stream through the Worker into R2 — no presigned URLs, no CORS, no egress fees.

**Prerequisite: Node.js 22+** (Wrangler 4 refuses older). With nvm: `nvm install 22` — the
repo's `.nvmrc` selects it automatically via `nvm use`. After switching Node versions, re-run
`rm -rf node_modules && npm install` so native modules rebuild.

## One-time setup (owner)

1. **Cloudflare** — log in and create the bucket:
   ```sh
   cd worker
   npx wrangler login
   npx wrangler r2 bucket create studioshot-images
   ```
2. **Supabase** — in the project's SQL editor, run `supabase/schema.sql`.
3. **Secrets** (never committed; skip FAL_KEY to stay on the mock provider):
   ```sh
   npx wrangler secret put FAL_KEY
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_KEY
   ```
4. **Switch segmentation on** — in `worker/wrangler.toml`, set
   `SEGMENTATION_PROVIDER = "fal"` (leave `"mock"` for a credential-free walking skeleton;
   the mock returns the photo uncut).
5. **R2 retention (originals)** — Cloudflare dashboard → R2 → `studioshot-images` →
   Settings → Object lifecycle rules: add a rule for prefix `originals/` deleting objects
   30 days after upload. Only `originals/` expires — `cutouts/` stay (results keep working),
   and the flywheel pairs under `masks/` + `training/` are kept indefinitely.

## Optional sign-in (magic link)

Anonymous use works with none of this. To enable "Sign in to keep your photos":

1. Supabase dashboard → **Authentication → Sign In / Up** — ensure the **Email** provider is
   enabled (magic links are its default).
2. **Authentication → URL Configuration** — set the Site URL to the deployed app
   (e.g. `https://studioshot.<subdomain>.workers.dev`), so magic links redirect back to it.
3. Create `app/.env.production` (gitignored) with the **client-safe** values:
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   This is the publishable key — never the secret one. When these are absent the sign-in UI
   is hidden entirely and the app is anonymous-only.
4. Rebuild and deploy. Username reservation needs the `usernames` table — rerun
   `supabase/schema.sql` if the project predates it.

## Every deploy

```sh
npm run build            # builds app/dist
cd worker && npx wrangler deploy
```

The Worker prints its `*.workers.dev` URL. A custom domain can be attached in the Cloudflare
dashboard later — nothing in the code assumes one.

## Local development

```sh
npm install
npm test                 # vitest, mock provider, in-memory everything
npm run build && cd worker && npx wrangler dev    # full stack at localhost:8787
```

Or for app iteration with hot reload: `npx wrangler dev` in `worker/` plus `npm run dev`
in `app/` — the Vite dev server proxies `/api` to wrangler on :8787.

The committed default is the real provider, so local dev needs a `worker/.dev.vars`
(gitignored) to run credential-free on the mock:

```
SEGMENTATION_PROVIDER=mock
```

Without Supabase secrets, records fall back to an in-memory map (fine locally; per-isolate
in production, so Supabase is required for a real deploy). The mock returns the photo uncut,
which also leaves lighting inert — fine for exercising the editor, useless for judging it.

## When the name is decided — domain, sender, branding

Parked until the product name is final (working title "Studioshot"). Do these together;
they all hang off the domain:

1. **Register the domain** — Cloudflare Registrar (at-cost, DNS lands in the same dashboard
   as the Worker).
2. **Point the domain at the Worker** — Cloudflare dashboard → Workers → this worker →
   Settings → Domains & Routes → add custom domain. Nothing in the code assumes a hostname.
3. **Transactional email** — sign up with Resend or Postmark (free tiers suffice), add the
   domain, paste their SPF/DKIM records into Cloudflare DNS.
4. **Custom SMTP in Supabase** — Project Settings → Authentication → SMTP Settings: enable,
   fill in the service's credentials, sender `hello@<domain>` / sender name = product name.
   ⚠ Supabase's built-in sender is dev-only and rate-limited to a few emails per hour — a
   signup rush (e.g. a NOVA table) will hit the wall. If sign-in is part of the pitch, do
   this before the event.
5. **Update auth URLs** — Supabase → Authentication → URL Configuration → Site URL to the
   new domain; rebuild + redeploy so the app and magic links match.
6. **Email templates** — Authentication → Emails: re-word "Confirm sign up" and "Magic Link"
   under the final name (keep `{{ .ConfirmationURL }}` as the link). Copy stays plain per
   DESIGN.md §3: no magic language.
7. **Rename sweep in the repo** — wordmark, `<title>`, terms page, `wrangler.toml` name,
   PLAN.md. It's a find-and-replace; nothing structural.

## Smoke test after deploy

Upload a photo from a phone, confirm the cutout appears on black and downloads. Then the real
test (CLAUDE.md): run the seven photos in `test-photos/bad-photos/` through it.
