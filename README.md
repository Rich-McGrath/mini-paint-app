# Miniature Photo Tool

> **Name TBD.** Working title "Value Check" is a leftover from an earlier version of the idea
> and no longer describes the product.

**Upload a phone photo of your painted miniature; get back something that looks like it was shot
in a studio.** Cut out of the cluttered background onto black, lighting corrected, ready to post.

**Status:** pre-build. Specification and design are settled; no application code written yet.

---

## Start here

| File | What it is |
|---|---|
| **[SPEC.md](SPEC.md)** | What to build, the roadmap, non-goals, and an evidence log of what was tested and falsified |
| **[DESIGN.md](DESIGN.md)** | Visual language, tokens, layout, accessibility |
| **[CLAUDE.md](CLAUDE.md)** | Project rules loaded automatically in Claude Code sessions |

Read SPEC.md §10 (Evidence log) before proposing features. Several obvious-looking ideas have
already been built and disproved, and the reasoning is recorded so they don't get rebuilt.

---

## Contents

```
SPEC.md                    product specification
DESIGN.md                  design guide
CLAUDE.md                  session rules
value-check.html           ARCHIVED prototype — see note below
test-photos/bad-photos/    seven real phone photos — the test fixtures
```

### `test-photos/bad-photos/`

Seven photographs of the owner's own miniatures, taken on a phone at a cluttered workbench, all
labelled by him as *bad* examples. They are the development fixtures — every image feature should
be tested against them, because they represent the real input far better than anything staged.

They are also the reason the value-scoring feature was abandoned: all seven scored well.

> These are personal work-in-progress photos. Keep the repository private, or remove them before
> making it public.

### `value-check.html` — archived

A working prototype of the abandoned value analyser. **Do not extend it.** Kept for one reason:
the colour conversion in it is correct and tested — sRGB → linear → CIE L\*, and the L\*→byte
lookup table. Reuse that maths for anything greyscale rather than re-deriving it.

Verification worth knowing: L\* 50 maps to sRGB byte **119**, not 128. The naive value is the
error that most "just desaturate it" advice quietly introduces.

---

## Before first commit

- Add a `.gitignore` — exclude `fixtures.js` and `contact-sheet.png` if present. Both are test
  byproducts, and `fixtures.js` is half a megabyte of base64 duplicating the photos.

---

## Deadline worth knowing

**NOVA Open, 29 August – 6 September 2026.** Nine days in a room full of exactly the target
users, with the owner attending. Anything shippable by then gets real testing with real painters;
anything that isn't waits months for an equivalent opportunity.

---

## Open decisions

- [ ] Product name
- [ ] Stack — framework, hosting, object storage vendor
- [ ] Which background-removal API (plumbing already exists from a previous project)
- [ ] Free tier limits, if any
- [ ] Whether the greyscale value view ships at all, given WIPicle already offers it
