---
name: verify-brand
description: Drives the interactive Ditto brand mark (DittoMark) in a real browser and proves its moods, persisted mood state, motion physics and reduced-motion behaviour are unchanged. Use after any edit to ditto-mark.tsx, logo.svg, the mood atom or a page that renders the mark, or when asked to verify the brand.
---

# Verify the brand mark

`apps/web/src/components/ditto-mark.tsx` is a **frozen contract**. A run replays every frame the browser draws through `MODEL` in `scripts/brand-check.mjs` and requires a floating-point match, and it diffs each mood's rendered SVG against `baseline/moods.json`. Any change to a constant, easing, spring, glyph, storage key or event path turns a check **red**. Red means drift until the user says the change was intended.

Run everything from the repo root. `B=.claude/skills/verify-brand/scripts/brand.sh`.

## 1. Launch

`$B up` starts the web app's Vite dev server on `127.0.0.1:4517`, in its own process group, and waits until `/design` server-renders the mark. It reuses an instance that it started itself, and refuses a port that some other process holds. To run beside another instance, set `VERIFY_BRAND_PORT=<free port>` on every `$B` call. The server needs no Cloudflare profile or database: `/design` and `/design/auth` are static pages.

Done when it prints `up: http://127.0.0.1:4517`.

## 2. Doctor

Run `$B doctor` first, and again whenever a run looks wrong. It is read-only and checks these things:

- The server belongs to this run.
- `/design` renders one neutral mark and `/design/auth` renders 9.
- `/logo.svg` is served.
- Node is version 22 or later.
- Chromium can be found (Playwright's cache or `CHROME_PATH`).
- The baseline exists.
- Whether `ditto-mark.tsx` or `logo.svg` has uncommitted edits. A run always checks the working tree.

Done when every line reads `ok` (a `note` line is information only).

## 3. Drive

`$B check` runs every check in headless Chromium: about 75s, exit `0` all pass, `1` a check failed, `2` the run broke. `$B check --only gaze,press-hop` runs a subset; `--headed` shows the browser. Ids and the user journey each covers live in [`features/README.md`](features/README.md). Each check's file there says what it proves and its gotchas; read it before trusting or debugging that check.

Checks drive the user path only: real CDP mouse and wheel input, real reloads, real second tabs. The in-page probe reads DOM attributes and `localStorage` and never calls app code. Only `stale-storage` writes `localStorage` directly, to simulate a value left by an older build.

Done when every check id you were asked to cover printed `PASS`, or each `FAIL` is explained in step 4.

## 4. Read a red

- **Exact-replay residuals** (`… residual: got 3e-2, want [0, 1e-9]`) mean the motion law changed. The failing law names the constant: breath, lean spring, eye sx sphere, lid curve, squash replay, hop replay, gaze held until idle.
- **`glyph drifted at char N`** prints the baseline and current markup around the first difference.
- **`Precondition:`** lines are the environment, not the mark. Fix the setup and rerun; never loosen a tolerance to get past one.

When the user confirms a change to the mark was intended, update the contract in the same change as the component:

- **Motion:** edit the matching line of `MODEL` (or `SPEC`) in `brand-check.mjs`, written the same way as the component's expression so the floating-point results match bit for bit.
- **Glyphs or markup:** run `$B check --only mood-cycle --update-baseline`, then show the user the `baseline/moods.json` diff.
- **New behaviour:** add a check and a feature-map entry for it.

## 5. Evidence

Each run writes `.scratch/verify-brand/<timestamp>/` (gitignored), with these files:

- `report.md` and `report.json`: every assertion with its measured value.
- `mood-<n>-<mood>.png`: each glyph.
- `persist-after-reload.png` and `shared-marks.png`.
- `frames-*.json`: every sampled frame.
- `replay-press-hop.json`: the frame-by-frame spring replay.

Cite the `report.md` path and the PASS/FAIL lines as proof.

## 6. Cleanup

`$B down` kills only the process group recorded by `$B up`, then removes the record. Run it after every run, including failed ones. Evidence and server logs stay in `.scratch/verify-brand/`. Each check runs in its own browser context, and the browser and its temp profile are removed at exit.
