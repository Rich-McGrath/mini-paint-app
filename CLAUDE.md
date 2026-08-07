# Project rules

**Read [SPEC.md](SPEC.md) and [DESIGN.md](DESIGN.md) before proposing or writing anything.**
This file is the short version; those two are authoritative.

**The product:** upload a phone photo of a painted miniature → cut it out onto black, correct the
lighting, download. That is v1 and the only thing being built now.

---

## Hard rules

These get violated by well-meaning default behaviour. Don't.

1. **Fix what the camera got wrong. Never fix what the painter got wrong.**
   White balance, exposure, shadow lift and sharpening are camera corrections — do them.
   **Contrast stretching and auto-levels are forbidden.** They manufacture value range the
   painting doesn't have, which lies to the user about their own work. This is the single most
   tempting mistake in the codebase.

2. **No AI aesthetic.** No sparkle or wand icons, no purple-blue gradients, no "magic" copy.
   Label it "Remove background", not "✨ AI Cutout". The users are a community actively blocking
   AI crawlers. The tech is a neural network; the presentation must not advertise it.

3. **Never gate the result behind masking.** Show the finished cutout immediately. Correction is
   optional polish, never a prerequisite. A previous version made masking mandatory and it killed
   the feature.

4. **Colour lives in the user's photograph, not in the interface.** A saturated UI next to an
   image shifts how its colour and value are judged. Chrome stays neutral and dark.

5. **Phone first.** These are phone photographs. Brush interactions are awkward on a phone, which
   is why the correction ladder is ordered trim line → tap-to-remove → brush.

---

## Do not rebuild

Recorded in SPEC.md §10 with the data. Briefly:

- **Value/contrast scoring from a histogram.** Built, tested, falsified. Seven models known to be
  flat all scored "wide range". The metric tracks background clutter, and it is unchanged if you
  shuffle every pixel — it has no notion of geometry, which is what value painting actually is.
  If a numeric quality score comes up again, the answer is no.
- **Client-side flood-fill background removal.** Fails on real bench photos. Segmentation is a
  paid API call.
- **Turntable / multi-photo spin.** Scrapped — 20× the compute and bandwidth, requires equipment
  most painters lack, and doesn't feed v2.

---

## Not in scope

No tutorial content. No paint inventory. No session logging, paint recipes or kit catalogue
(WIPicle occupies that space and does it well). No scores, streaks, badges or leaderboards.
No payments or revenue share. No profiles or gallery until v2, no critique until v3.

---

## Testing

Test every image feature against `test-photos/bad-photos/` — seven real phone photos at a
cluttered bench. Staged or synthetic images will make things look like they work when they don't;
that mistake has already been made once here.

Known failure modes in that set, for reference: the miniature is mounted on a paint pot in four of
seven (segmentation keeps the pot), one has a painted backdrop board behind it, and two are
hand-held.

---

## Stack

- **Storage:** cloud object storage — R2 preferred, no egress fees, and bandwidth is the main cost
- **Segmentation:** paid third-party API — *vendor TBD*, plumbing exists from a previous project
- **Framework / hosting:** *TBD*
- **Lighting correction:** pure image maths, independent of the API — buildable and testable now
- **Data model:** one image = one miniature = one kit tag. Flat. No frame sets or sequences.

---

## Legal and trust

- Terms must include a licence to use uploads to operate and improve the service, **from day one**
  — retrofitting consent is far harder.
- The segmentation vendor must be disclosed as a sub-processor.
- Public commitment: never used to train generative AI, never sold or licensed, deletable any time.
- Every user correction is a human-verified mask — the training data flywheel. Store downscaled
  images plus masks; full-resolution originals need not be retained.
