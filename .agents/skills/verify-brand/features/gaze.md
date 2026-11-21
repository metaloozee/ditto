# Gaze

The eyes follow the pointer anywhere on the page. They snap to it in about 60ms and narrow as they turn toward an edge, as if drawn on a sphere. The body leans the same way a beat later. Two and a half seconds after the pointer stops moving, the mark goes back to glancing on its own.

## Sub-features

- `gaze` moves the pointer to three targets relative to the mark's centre: right (+600, 0), up-left (−250, −250) and down (0, +250). For each target it checks these things:
  - The gaze recovered from the eyes switches to `pull = 1 − exp(−dist/220)` along the pointer's direction, within one frame of the `pointermove`, and stays there exactly.
  - The lean springs replay to 1e-7.
  - The settled eyes are at `8.5·sin(gx·π/4)` and `7.5·sin(gy·π/5)`.
  - The settled rotation is `4·gx`.
- The idle return: after the last move, the gaze holds exactly while `now − event.timeStamp ≤ 2500ms`. The first frame after that leaves the pointer's gaze.

## How to get to it (user POV)

- Open `/design` and move the mouse anywhere in the window.
- Stop moving and wait about 2.5s.

## Driving it with brand.sh

Preconditions:

- The mark sits at about (280, 275) on `/design` at 1280×900, so all three targets fall inside the viewport. The check reports a `Precondition:` failure if a layout change moves one outside.

- **Track.** Run `brand.sh check --only gaze`. The run saves `frames-gaze-right.json`, `frames-gaze-up-left.json` and `frames-gaze-down.json`.
- **Idle return.** The same run saves `frames-gaze-idle-return.json`, and the `gaze held until idle` fact is 0.

## Gotchas

- Touch pointers are ignored for gaze. CDP mouse input is always `pointerType: "mouse"`, and no check covers touch.
- The app measures the idle window from the `pointermove` event's `timeStamp` and compares it with the rAF time. The probe records both, and the check uses the same clock as the app.
- The pointer must stay inside the viewport. A move outside it never reaches the page.
