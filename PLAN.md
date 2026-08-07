# Build Plan — v1

Companion to [SPEC.md](SPEC.md) and [DESIGN.md](DESIGN.md). This document turns the settled
spec into an ordered build. It does not re-open decisions recorded there.

**Last updated:** 7 August 2026
**Hard date:** NOVA Open, 29 August – 6 September 2026 — 22 days out. Anything shippable by
then gets tested in a room full of the target users.

---

## 1. Working assumptions

The spec leaves four decisions open. Building can't wait on them, so the plan adopts a default
for each. All four are cheap to reverse if overturned; none is silently final.

| Open decision | Default adopted here | Why | Cost to reverse |
|---|---|---|---|
| **Name** | "Studioshot" — the name both design mockups already use | Mockups, copy and domain placeholder (`studioshot.app`) are already written under it | Find-and-replace before launch |
| **Stack** | Cloudflare (Pages + Workers + R2) + Supabase (Postgres + Auth) | R2 is already the stated storage preference and zero egress fees serve the "bandwidth is the main cost" constraint; the owner's previous app already runs exactly this combination (Cloudflare Worker with server-only vendor keys, Supabase alongside), so accounts, patterns and plumbing all exist. Supabase Auth covers optional sign-in and day-one username reservation without building auth | Frontend is a plain Vite SPA and the API is small — portable |
| **Segmentation API** | fal.ai queue API first — this is the existing plumbing from the previous project (`FAL_KEY`, server-only, queue-based calls from a Worker) — behind a `SegmentationProvider` interface; bake off fal-hosted matting models against the seven bad photos, with one commercial API as a control | Reusing working plumbing is days saved; fal hosts the strongest open matting models pay-per-use; the interface still makes the vendor a config change if quality disappoints | None — the interface is the point |
| **Value view in v1** | Out | WIPicle ships it; SPEC §10 says "minor feature at most". Nothing else depends on it | Additive later; the L\* maths is preserved either way |

Bake-off candidates, all reachable through the existing fal.ai plumbing: **BiRefNet v2**
(state-of-the-art open matting, cheap per call) and **BRIA RMBG-2.0** (commercially licensed,
trained on product shots), plus **remove.bg or Photoroom** as an external control if neither
clears the bar. Judged on: pot/handle behaviour, thin structures (spears, banners, antennae),
edge quality at full resolution, latency through the queue API, and per-image price. The u2net
floor test in SPEC §10 means any production model should clear the bar.

Two notes from the previous project's stack: the **SAM 3** access that exists there but is
unused is a plausible v1.x upgrade for tap-to-remove (tap point → segment → subtract from
mask) — noted, not scoped into v1. And the Anthropic/Claude text plumbing has **no use in
v1**: this product has no text-generation or vision-critique features, and adding any would
collide with the no-AI-aesthetic rule and the v3 critique sequencing.

---

## 2. Former blockers — both resolved

Two files the README documents were initially absent from the repository. Both have since
been committed (7 August 2026), so nothing blocks any milestone:

1. **`test-photos/bad-photos/`** — the seven fixture photos are in the repo. Every image
   feature is tested against them; the known failure modes (pot mounts ×4, backdrop board ×1,
   hand-held ×2) are the acceptance criteria for the correction tools.
2. **`value-check.html`** — recovered. The tested sRGB → linear → CIE L\* conversion and the
   `L_TO_BYTE` lookup table live at the top of its script block; the lighting pipeline reuses
   that maths rather than re-deriving it, verified by the L\* 50 → sRGB byte 119 check.

Per the README: these are personal WIP photos — the repository stays private, or they come
out before it goes public.

---

## 3. Architecture

```
Phone browser (SPA, dark-only, phone-first)
  │  direct-to-R2 upload (presigned URL from the Worker)
  ▼
Cloudflare Worker (Hono)
  ├── POST /uploads        → presigned R2 PUT, creates image record (Supabase Postgres)
  ├── POST /segment        → SegmentationProvider adapter → fal.ai queue API → mask to R2
  ├── GET  /images/:id     → record + signed URLs
  └── POST /masks/:id      → store user-corrected mask (the flywheel)
R2 buckets: originals (short retention) · downscaled+masks (kept) · exports (transient)
Supabase: Postgres — images(id, user_id, kit_tag, created_at, …), flat, one image = one
  miniature = one kit tag; Auth — optional sign-in, anonymous user IDs for signed-out use,
  usernames reserved at signup (both spec day-one requirements)
```

Division of labour, and why:

- **Segmentation: server-side**, behind the adapter. Keeps the vendor key secret, makes the
  vendor swappable, and lets the Worker store the raw mask — every subsequent correction
  diffs against it.
- **Lighting correction: client-side**, pure canvas/typed-array maths in a small dependency-free
  module. It needs the mask and the original, both already on the client; running it locally
  makes the before/after slider and re-renders instant and free. The module is pure
  (pixels in → pixels out) so the same code runs under Node in tests against the fixture photos.
- **Mask editing: client-side** on a working copy of the mask. Edits are non-destructive mask
  operations with an undo stack; the original photo is never modified.
- **Export: client-side** composite onto true black → PNG download. The final mask (if edited)
  posts back to `/masks/:id` downscaled — the human-verified training pair.

### The lighting pipeline (Milestone 2 — the real software)

Order matters; each step feeds the next. All operate in linear light, converting via the
recovered L\* maths.

1. **White balance** — grey-world estimate computed from *background* pixels (the mask tells us
   which pixels are desk, and desks/lamps are where the orange cast lives), applied globally.
2. **Exposure** — set from the *masked subject's* luminance distribution, not the whole frame.
   This is the correction a phone camera cannot do and the mask makes trivial. Target: subject
   midtones placed correctly; no clipping introduced.
3. **Shadow lift** — a gentle curve applied only below a luminance threshold, lifting murk
   without touching midtones or highlights.
4. **Sharpening** — modest unsharp mask, radius tuned for phone-camera softness, applied last.

**Forbidden, enforced in review and in tests: contrast stretching, auto-levels, histogram
equalisation, saturation boosts.** A unit test will assert the pipeline never expands the
subject's value range beyond what white balance + exposure shift account for. Fix what the
camera got wrong; never fix what the painter got wrong.

### The correction editor (Milestone 3)

Implements `design/EditorPhone.dc.html` (the "dock" variant as default), which is already
faithful to DESIGN.md. Ladder in frequency order, all non-destructive with shared undo:

1. **Trim line** — one drag; clears mask below the line. Kills the paint-pot failure (4 of 7
   fixtures). The applied trim is remembered (per-user, or localStorage signed-out) and offered
   as the default on the next upload — second photo takes one tap, tenth takes none.
2. **Tap to remove** — connected-component analysis on the mask alpha; tap deletes the
   component under the finger. Kills the backdrop-board failure.
3. **Add/erase brush** — masked brush with three sizes; the fallback for spears, banners,
   antennae. Deliberately last: brushes are awkward on a phone.
4. **Edge loupe** — magnified edge inspector; catches bad edges before posting, not after.

Plus, per spec: cutout shown immediately (masking is never a gate), before/after slider with
the 400–600ms reveal as the single motion indulgence (`prefers-reduced-motion` honoured),
switchable preview background (black `#000000` / mid-grey `#777777` / white), export always
on black.

---

## 4. Milestones

Ordered as a walking skeleton — a thin deployed end-to-end slice first, then depth. This
de-risks the two things we don't control (vendor API behaviour, hosting) earliest, and means
there is always a demoable build as NOVA approaches.

### M0 — Repo and scaffolding *(days 1–2)*
- `.gitignore` (excludes `fixtures.js`, `contact-sheet.png` per README), Vite + TS scaffold,
  Worker scaffold, CI running lint + tests
- Design tokens from DESIGN.md §4 as CSS custom properties — the only styling source
- Fixture photos + `value-check.html` landed (owner, see §2)

### M1 — Walking skeleton *(days 2–7)*
- Upload → presigned R2 PUT → `SegmentationProvider` (mock first, then first real vendor) →
  cutout composited on black → auto-crop to subject → download PNG. Deployed to a real URL.
- Terms of service page with the day-one licence clause and sub-processor disclosure (§6)
- **Exit test:** a phone photo goes in, a downloadable cutout comes out, on a public URL.

### M2 — Lighting pipeline *(days 7–12)*
- The four-step pipeline above as a pure, Node-testable module; before/after slider in the app
- Vendor bake-off runs in parallel against the seven fixtures; vendor picked, price known
- **Exit test:** all seven bad photos through the full pipeline; white balance visibly corrects
  the desk-lamp cast; the no-contrast-stretch invariant test passes.

### M3 — Correction editor *(days 12–19)*
- Trim line → tap-to-remove → brush → loupe, undo, remembered trim, corrected-mask upload
- **Exit test:** each of the seven fixtures' known failures fixed in ≤ 10 seconds of gestures;
  pot photos need only the trim line.

### M4 — NOVA hardening *(days 19–22)*
- Real-device passes (iOS Safari + Android Chrome), slow-network behaviour, error states,
  minimal landing page from the `Studioshot Editor.dc.html` hero (2a split or 2b slider)
- Optional sign-in (keep history) via Supabase Auth with username reservation; anonymous user
  ID stored against every image from day one regardless
- **Exit:** the owner can hand their phone to a stranger at NOVA and watch them succeed.

Deliberately after NOVA: kit tagging UI (v2 groundwork), account management beyond sign-in,
free-tier enforcement (decision needs the bake-off price), marketing site beyond the landing page.

---

## 5. Testing policy

- **Fixtures are the seven bad photos.** Every image feature is validated against them.
  Synthetic or staged images are used only for exact-maths unit tests (colour conversion,
  mask ops) — never as evidence a feature works.
- **Pipeline invariants as unit tests:** no contrast stretch beyond WB+exposure accounting;
  original never mutated; export background exactly `#000000`; L\* 50 → byte 119.
- **Editor acceptance:** the ≤ 10-second fix criterion from SPEC §10, per fixture failure mode.

## 6. Legal, from day one (in M1, not later)

- Terms include the licence to use uploads to operate and improve the service
- Segmentation vendor named as sub-processor (finalised when the bake-off picks the vendor)
- Public commitment on the terms page: never used to train generative AI, never sold or
  licensed, deletable any time
- Retention matches the flywheel: downscaled image + mask kept; full-resolution original
  deletable/expirable

## 7. Copy and presentation rules (enforced throughout)

"Remove background", "Fix lighting", "Processing…" — describe what it does, never sell the
model. No sparkle/wand icons, no gradients, no "magic". Accent colour on interactive
affordances only, never adjacent to the preview. Dark-only tool UI.

---

## 8. What this plan does not do

Per CLAUDE.md and SPEC §7/§10: no value/contrast scoring, no client-side flood-fill, no
turntable, no tutorials, no inventory, no logging/recipes, no gamification, no payments, no
profiles or gallery (v2), no critique (v3).
