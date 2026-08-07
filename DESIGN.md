# Design Guide

Companion to [SPEC.md](SPEC.md). Covers the app UI and the marketing site.

**Last updated:** 6 August 2026

---

## 1. The governing principle

> **The interface must not compete with the artwork — and must not change how it is perceived.**

This is not a taste preference. Simultaneous contrast means a saturated or vivid interface
adjacent to an image measurably shifts how a viewer judges the colour and value *inside* that
image. It is why Lightroom, Capture One, Photoshop, Darkroom and Halide have all been neutral
grey for twenty years while trends came and went.

For an app specifically about how a painted model reads, it matters twice over.

**Colour appears in the user's photograph. Almost nowhere else.**

---

## 2. Trends: adopt, adapt, reject

Assessed against the 2026 trend lists.

### Adopt

- **Dark mode** — as a viewing environment, not a style. Neutral and desaturated.
- **Restraint / "white space as colour"** — applied as focus. One thing on screen at a time.
- **Sustainable web design** — lean code, optimised images. The only trend that is also a
  business decision: bandwidth is the main running cost, so leanness is how this stays cheap.
- **Cinematic motion, in exactly one place** — the before/after reveal. That is the emotional
  payoff of the entire product. Spend the whole motion budget there; everything else is instant.

### Adapt

- **Bento grid / micro-maximalism** — the v2 index page *is* a grid of cutouts. Let the
  miniatures be the maximalism; the container stays plain.
- **Bold typography** — marketing site only. Never inside the tool.

### Reject

| Trend | Why not |
|---|---|
| Vibrant palettes, gradients, duotones | Colour-casts the user's judgement of their own photo |
| Neumorphism / glassmorphism | Low contrast, fights the image for depth cues, poor accessibility |
| 3D / immersive / spatial | We have 2D photographs. Nothing to render. Cost with no payoff. |
| Gamification | An explicit non-goal — it is what the Painting Ledger gets wrong |
| Neo-brutalism / anti-polish / raw authenticity | We are asking painters to trust us with their artwork *and* to believe the output is faithful. Deliberate imperfection undercuts both. An app that makes things look professional must not look unfinished. |
| Retrofuturism, maximalism, collage | Compete directly with the imagery |
| Experimental navigation | Hostile in a utility |
| AI chatbots / voice UI | Irrelevant here — see below |

---

## 3. No AI aesthetic

**Avoid the visual language of AI products entirely.** No purple-blue gradients, no sparkle or
wand icons, no "magic" framing.

Our users are a community actively blocking AI crawlers — Putty & Paint disallows ClaudeBot by
name. The technology underneath *is* a neural network and that is fine; advertising it in the
aesthetic is not.

| Use | Not |
|---|---|
| Remove background | ✨ AI Magic Cutout |
| Fix lighting | Enhance with AI |
| Processing… | Our AI is thinking… |

Describe what it does. Never sell the model.

---

## 4. Tokens

### Colour — dark neutral

| Role | Value |
|---|---|
| Canvas | `#0E0E11` |
| Surface | `#16161A` |
| Surface raised | `#1D1D22` |
| Border | `#26262C` |
| Border strong | `#34343C` |
| Text primary | `#E8E8EC` |
| Text secondary | `#A0A0AC` |
| Text tertiary | `#6E6E7A` |
| Accent (interactive only) | `#6E8ACF` |
| Success | `#5FA97B` |
| Warning | `#C9A24D` |
| Danger | `#C96A6A` |

All semantic colours deliberately desaturated. The accent appears **only** on interactive
affordances, never as decoration, and never immediately adjacent to the image preview.

**Canvas is near-black, not pure black.** The output sits on true black, so pure-black chrome
would make the image edges disappear. The preview gets a defined frame.

### Preview backgrounds — user-switchable

Judging a dark model against black is genuinely hard. Every professional tool lets you change it.

| Option | Value | Note |
|---|---|---|
| Black | `#000000` | The export background |
| Mid grey | `#777777` | True perceptual middle — L\* 50. **Not** `#808080`, which is the naive-desaturation error. |
| White | `#FFFFFF` | |

### Type

One neutral sans, system stack — fast, no webfont payload, serves the leanness goal.

```
-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif
```

Scale: `12 · 13.5 · 15 · 18 · 24 · 32`   Weights: `400 · 550 · 700`

No expressive or display faces inside the tool.

### Spacing & shape

Base unit 4px — `4 · 8 · 12 · 16 · 24 · 32 · 48`
Radius — controls `6`, cards `10`, preview frame `12`

### Motion

| Case | Duration |
|---|---|
| Most UI state changes | instant |
| Hover, focus, panel transitions | 120–160ms, ease-out |
| **The before/after reveal** | 400–600ms — the one indulgence |

Honour `prefers-reduced-motion` everywhere, including the reveal.

---

## 5. Layout

### Phone is the primary surface

These are phone photographs. Most people will upload, fix and download without ever touching a
desktop. Design for the phone first and let desktop be the generous version.

Consequences:

- **Touch targets 44px minimum.**
- **Brush work is awkward on a phone** — which is exactly why the correction ladder is ordered
  trim line → tap-to-remove → brush. The one-gesture tools carry most of the load.
- Controls sit within thumb reach, along the bottom.

### The editor

- **The image dominates.** Controls live in a slim bar, not a surrounding chrome frame.
- Tools presented in frequency order: **trim line, tap-to-remove, brush**.
- Undo always visible, never buried.
- A zoomed edge inspector — nobody notices a bad cutout edge until after they've posted it.
- Never gate the result behind masking. Show the finished cutout immediately; correction is
  optional polish.

---

## 6. Accessibility

- Body text ≥ 4.5:1 contrast; large text ≥ 3:1
- Never rely on colour alone to convey state — pair with icon or text
- Full keyboard path through the editor on desktop
- Visible focus rings, using the accent
- `prefers-reduced-motion` respected
- Alt text on user images defaults to the kit name once v2 tagging exists

**Dark-only for the tool**, matching every professional image editor, because a light UI around a
photograph actively harms value judgement. The marketing site supports both schemes.

---

## 7. Two surfaces, two rules

| | Job | Personality |
|---|---|---|
| **Marketing site** | Sell it | Big type, a striking hero, some motion. Allowed to have character. |
| **The tool** | Serve it | Nearly invisible. Disappears behind a miniature. |

The hero image on the site should be a real before/after: a genuine cluttered-bench photo beside
its cutout. The product demonstrates itself better than any copy will.

---

## 8. Reference points

- **Darkroom, Halide** — restraint under a photograph, controls that vanish
- **Lightroom, Capture One** — neutral surrounds, switchable backdrops
- **Cosmos, Are.na** — grids that let images carry everything *(relevant to the v2 index)*

---

## 9. Open questions

- [ ] Name and wordmark — "Value Check" no longer describes the product
- [ ] Does the tool ever need a light mode, or is dark-only defensible long term?
- [ ] Index page density for v2 — how many cutouts per row before comparison stops working?
- [ ] Empty state for a kit with only one or two uploaded versions
