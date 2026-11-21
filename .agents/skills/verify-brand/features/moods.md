# Moods

Clicking the mark changes its expression. The nine moods go in a fixed order and wrap around to the start: neutral, happy, love, surprised, wink, angry, sad, dizzy, sleepy. The accessible name always says the current mood.

## Sub-features

- `mood-cycle` covers nine clicks: each advances one mood, and the ninth wraps to neutral. The name updates each time, and each mood's rendered SVG matches `baseline/moods.json` exactly.
- `logo-sync` checks that the mark's shadow, plate, rim, bezel and screen paths, and its neutral eyes, match the drawn paths in `public/logo.svg`.

## How to get to it (user POV)

- Open `/design`. In the Brand section, click the mark.
- Click any mark on `/sign-in`, `/sign-up`, `/design/auth` or the signed-in home.
- Focus the mark with Tab and press Enter or Space. It is a native button, but no check covers the keyboard yet.

## Driving it with brand.sh

Preconditions:

- Fresh context (mood `neutral`).
- Reduced motion is emulated, so the glyph swaps immediately and the SVG has no transforms. That makes the markup deterministic.

- **Cycle.** Click the centre of the mark nine times. Run `brand.sh check --only mood-cycle`. The sequence fact reads the nine moods then `neutral`, and `localStorage["ditto-mood"]` is `"neutral"`.
- **Glyphs.** For each mood, the button's `outerHTML` (with `useId` ids normalised to `ID-*`) equals the baseline. The run saves `mood-<n>-<mood>.png` crops.
- **Logo sync.** Run `brand.sh check --only logo-sync`. The path data equals what `/logo.svg` draws after its `</defs>`.

## Gotchas

- The baseline covers the whole button markup, including classes, gradients, stroke widths and the bloom filter. A class change on the `/design` mark trips it too, which is intended.
- `logo.svg` repeats the screen path inside `<defs>` as its clip path. Compare only what it draws.
- Regenerate the baseline (`--update-baseline`) only after the user approves the visual change, and show them the diff.
