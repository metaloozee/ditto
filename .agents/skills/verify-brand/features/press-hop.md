# Press and hop

Pressing the mark squashes it. Releasing it makes the mark hop and stretch, blink, and change mood while its eyes are shut. If the pointer drags off the mark before release, the press is cancelled and the mood stays the same.

## Sub-features

- `press-hop`: a press squashes toward 0.92 on the 600/20 spring. The release kicks the squash with v = 3 and the hop with v = −150 on the 300/16 spring.
  - The squash and the body y replay exactly from the frame where each event landed.
  - The click blink follows the lid curve, and it takes one of three paths: `direct` (it starts at the click), `queued behind running blink` (it starts on the first tick after the running blink ends), or `joined closing blink`.
  - The glyph and the accessible name swap on the first or second frame after the eyes are shut.
- `press-cancel`: press, drag 300px off the mark, then release. The squash returns to 1 and the mood stays `neutral`.

## How to get to it (user POV)

- Open `/design`. Press and hold on the mark, then let go.
- Press on the mark, drag off it, then let go.

## Driving it with brand.sh

Preconditions:

- The pointer rests at the mark's centre, and the whole press and release finishes within 2.5s of the last move. Otherwise idle glances would move the lean in the middle of the replay; the check reports a `Precondition:` failure if that happens.

- **Press and release.** Run `brand.sh check --only press-hop`. The facts include the squash minimum and stretch maximum (about 0.903 and 1.040 at 60Hz) and the hop apex (about −3.80). The run saves `replay-press-hop.json` with every frame's replay.
- **Cancel.** Run `brand.sh check --only press-cancel`.

## Gotchas

- A spontaneous blink often overlaps the click. The `click blink path` fact says which of the app's paths was taken. If it reads `none`, that is a real regression in the blink queue.
- The swap happens one frame after the shut tick because React commits the new glyph after the tick that calls `nextMood`. Up to one frame late passes.
