# Brand mark verification map

The maintained source for what the Ditto brand mark does, from the user's side. Read this index before driving the mark, then use the matching feature file as the recipe.

## Baseline preconditions

- The app is running from `brand.sh up` at `http://127.0.0.1:4517`, and `brand.sh doctor` reports all `ok`.
- The mark renders once on `/design` (the Brand section) and 10 times on `/design/auth`. It also renders on `/sign-in` and `/sign-up`, which use the same component. The workspace sidebar draws it `still` (a picture, not the interactive mark).
- Every check opens its own browser context, so `localStorage` starts empty and the mood starts `neutral`.
- Viewport 1280×900, device scale 1, headless Chromium at 60Hz.

## Driving conventions

- The handle is the button whose accessible name matches `Ditto, feeling <mood>. Change mood`. The probe finds marks with `button[aria-label^="Ditto, feeling"]`.
- Input is CDP `Input.dispatchMouseEvent` at the mark's bounding-box centre (`mouseMoved`, `mousePressed`, `mouseReleased`, `mouseWheel`).
- Motion is read from the `transform` attributes of the body group (`svg > g`) and the eye and bloom groups inside the two clip groups.
- Run checks with `brand.sh check --only <id>[,<id>]`.

## Proof and skip reporting

- Proof is the run's `report.md` plus the screenshots and frame dumps it names.
- A `Precondition:` failure is reported as unverified, with its reason. It is never reported as a pass.

## Features

| Feature | Check ids |
| --- | --- |
| [Moods](./moods.md): click cycles nine glyphs | `mood-cycle`, `logo-sync` |
| [Mood memory](./mood-memory.md): one mood per browser, kept across reloads and tabs | `ssr-neutral`, `persist-reload`, `stale-storage`, `shared-marks`, `cross-tab` |
| [Idle life](./idle-life.md): breath, sway, glances, blinks | `idle-life`, `offscreen-pause`, `reduced-motion` |
| [Gaze](./gaze.md): eyes and body follow the pointer | `gaze` |
| [Press and hop](./press-hop.md): squash, hop, mid-blink mood swap | `press-hop`, `press-cancel` |
