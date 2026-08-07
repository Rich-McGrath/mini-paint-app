# Miniature Photo Tool — Product Spec

> **Name: TBD.** The working title "Value Check" is now wrong — it was named when the app
> was a value analyser. It is a photo tool. Needs renaming before anything is public.

**Last updated:** 6 August 2026

---

## 1. What it is

**Upload a phone photo of your painted miniature; get back something that looks like it was shot in a studio.**

Cut out of the cluttered background onto black, lighting corrected, ready to post.

## 2. Who it's for

Painters who shoot on a phone at a messy desk, own no lightbox, and whose photos never do
their models justice. Which is nearly everyone in the hobby.

## 3. Where it sits

| | Tooling | Audience |
|---|---|---|
| **WIPicle** | Good — logging, recipes, value study, kit catalogue | None — private by design, no public URLs |
| **Putty & Paint** | None | Yes — established showcase gallery |
| **Sprue / Figure Case / Painting Ledger** | Backlog tracking, streaks, leaderboards | Some |
| **This app** | The thing that makes a photo good enough to show *anywhere* | Borrowed — output goes to Instagram, Reddit, P&P |

Positioning: **upstream of every destination.** Not competing for where the picture ends up.

---

## 4. v1 — scope

The only thing that ships first.

### Flow

1. **Upload** one photo
2. **Cutout, automatic** — shown immediately, no masking step before the user sees a result
3. **Auto-crop** to the subject
4. **Lighting correction**
   - White balance (removes the orange desk-lamp cast)
   - Exposure set from the *model*, not the room — impossible for a phone camera, easy once you have the mask
   - Shadow lift
   - Sharpening
5. **Before/after slider**, original never modified
6. **Download**

### Correction tools

Ordered by how often they're needed. Most users should need zero or one gesture.

| Tool | Gesture | Fixes |
|---|---|---|
| **Trim line** | One drag | Paint pot / painting handle. Most common error by far. |
| **Tap to remove region** | One tap | Stray contiguous blob (e.g. a backdrop board) |
| **Add/erase brush** | Brush | Clipped spears, banners, antennae. Fallback, not the main tool. |

Plus: undo, non-destructive (edits live on the mask), zoomed edge view.

**Remember corrections between photos.** If someone always shoots on the same pot, default the
trim line from their last upload. Second photo takes one tap, tenth takes none — and it quietly
rewards shooting consistently.

### The rule that must never break

> **Fix what the camera got wrong. Never fix what the painter got wrong.**

White balance, exposure, shadow lift, sharpening — camera errors, correct them.
**Contrast stretching is forbidden.** It manufactures value range the painting doesn't have,
which is lying to someone about their own work.

---

## 5. Technical decisions

| Decision | Choice | Notes |
|---|---|---|
| Storage | Cloud object storage | R2 preferred — no egress fees matter for serving images |
| Segmentation | **Paid API** | Already set up from another project. Which vendor: TBD |
| Lighting correction | Independent of the API | Pure image maths, buildable and testable now |
| Data model | **One image = one miniature = one kit tag** | Flat. No frame sets, no sequences. |
| Accounts | Optional | Usable signed out. Sign in only to keep history. |

**Store a user ID against every image from day one**, even with no profile UI. Cannot be
reconstructed later.

**Reserve usernames at signup.** Trivial now, awkward once there are users.

### Known API risk

Commercial background-removal APIs are tuned for people and product shots. None have seen many
spears, banners or antennae. Expect thin-structure failures and design the correction tools
around the specific vendor's weaknesses. Per-image price determines whether a free tier is viable.

---

## 6. Roadmap

- **v1** — Photo cleanup *(above)*
- **v2** — **Tag the kit → the index.** Fifty painters' versions of the same model, presented
  identically. Solves the most common real behaviour in the hobby: *"how have other people
  painted this?"* Works at low volume because value is per-kit, not global.
- **v3** — **Critique**, layered onto index pages people already visit. This is where the
  load-bearing assumption finally gets tested.
- **later / maybe** — coaching and workshops, only if v3 proves painters will give honest feedback.

**Scrapped:** turntable / multi-photo spin. 20× the compute and bandwidth per model, needs a
turntable most painters don't own, and — decisively — it doesn't feed v2.

**Orthogonal, separate bet:** a global calendar of painting workshops, classes and competition
deadlines. Genuinely absent from the market and useful at zero users, but shares no code and no
users with this. Do it any time, or never. Don't let it queue behind this.

---

## 7. Non-goals

- **No tutorial library.** More content is the disease, not the cure.
- **No paint inventory.** Solved and crowded.
- **No logging / recipes / kit catalogue.** WIPicle occupies this and does it properly.
- **No scores, streaks or leaderboards.** See the evidence log.
- **No payments or revenue share.** Pros take Venmo at 0%; no take rate beats that.

---

## 8. Rules we're holding

### On images

> Your images stay yours. We use them to run the service and to improve our cutout accuracy.
> We never use them to train generative AI, never sell or license them, and you can delete them
> any time.

- The licence clause goes in the terms **from day one**. Retrofitting consent is far harder.
- The segmentation vendor must be **disclosed as a sub-processor** (GDPR).
- Artists' objection is to *generative* training, not to matting models. Naming that distinction
  costs nothing and buys trust.

### On honesty

The app can make your photo better. It must never make your painting look better than it is.

---

## 9. The flywheel

Every correction a user makes is a human-verified mask on painted miniatures — a dataset nobody
else has and nobody else will bother to collect for a niche this size. **The fix-it tool is the
training pipeline.** Downscaled images plus masks are sufficient; full-resolution originals never
need to be retained.

This holds even with a rented segmentation API. You don't own the model; you own the corrections.

---

## 10. Evidence log

Recorded so these aren't rebuilt later.

### Value scoring — **falsified, do not rebuild**

A histogram-based value analyser was built and tested.

- Against synthetic fixtures with known value structure, the maths was **exact** (range 84/84,
  32/32, 58/58).
- Against **seven real bench photos of models known to be flat, all seven passed** — reported
  ranges 66–88, every one reading "good" or "very wide."
- The lowest score in the set came from the photo with the *cleanest background*. **The metric
  tracks background clutter, not painting quality.**
- Fundamental flaw: the number is **unchanged if you shuffle every pixel at random.** Value
  painting is the relationship between value and geometry; a histogram has no geometry.

Conclusion: numbers were the wrong idea. The greyscale *view* is useful; the score is not.

### Value view — works, but not a differentiator

Perceptual greyscale (CIE L\*, not the phone's saturation slider — mid-grey is byte 119, not 128)
plus posterisation makes value collapse instantly visible, on any photo, with no masking.

**But WIPicle already ships this** (one-tap monochrome, notan posterisation to 3 bands). Keep as a
minor feature at most. Not a selling point.

### Segmentation — **clears the bar**

Seven real bench photos through an off-the-shelf model (u2net, deliberately the weakest option),
no manual input:

- ✅ All seven backgrounds removed — paint racks, cutting mats, kitchen towel, workbench
- ✅ Fingers removed in both photos where the model was hand-held
- ✅ Thin structures largely survived — claws, crests, staff rings, blades
- ❌ **Paint pot kept in 4 of 7** — the model reads miniature-plus-pot as one object
- ❌ One backdrop board kept, and its plinth clipped
- ⚠️ Edges soft — inference at 320px upscaled to 3000×4000

**Every failure is 5–10 seconds of user effort from fixed.** That is categorically different from
the value score, which no amount of user effort could repair. A production API and the correction
ladder will do better than this floor.

### Sharing — weaker than assumed

The original brief called the analyser "inherently shareable." It isn't:

- A diagnostic produces unflattering results, and sharing runs on pride
- An arbitrary index has no shared meaning to an audience
- Scores are a leaderboard by another name — the thing we criticised elsewhere

What painters *do* share: finished models, and the same model painted twice years apart. The
plausible distribution vector is a **critic** posting a value view to make a point in a critique
thread — not the painter posting a score.

Consequence: distribution is deliberate work, not a property of the product. NOVA (29 Aug –
6 Sept 2026) is nine days in a room full of exactly the right users.

---

## 11. Open decisions

- [ ] **Name.** "Value Check" no longer describes the product.
- [ ] **Which segmentation API**, and its per-image price → determines free-tier viability
- [ ] Free tier limits, if any
- [ ] Whether the value view ships in v1 at all, given WIPicle

---

## 12. Status

- Value-view prototype: built and tested — `value-check.html`
- Segmentation: tested against real photos, viable
- **Next build:** lighting correction pipeline + the correction editor UI.
  The segmentation is bought; **the editor is the software you actually write.**
