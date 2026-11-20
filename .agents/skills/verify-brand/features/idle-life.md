# Idle life

Left alone, the mark looks alive. It breathes, its eyes sway slightly and glance around, its body leans after its eyes, it floats, and it blinks. The motion stops while the mark is off screen. When the OS asks for reduced motion, the mark stays still.

## Sub-features

- `idle-life` records 9s of frames with no input and replays each frame through `MODEL` to match:
  - Breath matches `1 + 0.012·sin(2πt/3.4)` within 1e-9, and squash stays exactly 1.
  - Rotation is always `4·lean`.
  - The eye's horizontal scale matches the sphere projection.
  - The lean springs (260/24) match in x and y to 1e-7.
  - The gaze target recovered from the eyes, minus the sway, is constant between glances. Glances stay inside x ∈ [−0.6, 0.6] and y ∈ [−0.45, 0.35], and each holds for 1.5–4s; the centre glance may hold longer when re-picked.
  - Every blink matches the lid curve (close 90ms, hold 50ms, open 140ms) to 1e-6. Each blink starts on a frame and has a cause: a scheduled blink 3.5–7s after the last, a double blink 360–420ms after it, or a glance.
- `offscreen-pause`: scrolling the mark out of view freezes its transform. Scrolling it back resumes motion.
- `reduced-motion`: with reduced motion emulated, no transform is set on the body, eye or bloom groups, and a click swaps the mood within a frame (no blink).

## How to get to it (user POV)

- Open `/design` and leave the pointer still.
- Scroll the page down past the Brand section, then back up.
- Turn on the OS setting to reduce motion and open `/design`.

## Driving it with brand.sh

Preconditions:

- A fresh context. The pointer has not moved since load, so the mark is idle from the first frame.

- **Idle replay.** Run `brand.sh check --only idle-life`. All residual facts are within their bounds, and `frames-idle-life.json` holds every frame.
- **Offscreen.** Run `brand.sh check --only offscreen-pause`. The mark is moved with mouse-wheel input, not `scrollTo`.
- **Reduced motion.** Run `brand.sh check --only reduced-motion`. The probe sets `prefers-reduced-motion: reduce` through `Emulation.setEmulatedMedia` before navigating.

## Gotchas

- The motion laws are integrated once per frame, so their peaks depend on frame rate (the hop is −3.80 at 60Hz and −4.35 at 120Hz). The replay uses the recorded frame times, so jitter can't cause false failures. Never compare against a continuous-time solution.
- The probe's rAF callback runs after the app's tick in the same frame, so both see the same timestamp. That is what makes an exact replay possible. A frame where the probe runs before the app's tick breaks the replay on purpose.
- A blink that was already running when recording started has no recorded start frame, so only its curve is checked.
- The chance of failing on randomness is low, but not zero. If `glance changes in 9s` falls outside [2, 7], rerun before you call it drift.
