# Mood memory

The mood belongs to the browser, not to one mark. Every mark on a page shows the same mood, and the mood survives a reload. A change in one tab reaches the other open tabs. The server can't see the browser's storage, so it always renders `neutral`. The stored mood takes over after hydration.

## Sub-features

- `ssr-neutral`: the server HTML for `/design` has one mark and `/design/auth` has 8, all with the name `Ditto, feeling neutral. Change mood`.
- `persist-reload`: two clicks give `love`, stored as `localStorage["ditto-mood"] = "\"love\""` (JSON). After a reload, the mark shows `love` within 3s of hydration.
- `stale-storage`: a stored `"bogus"`, `not json{` or `{"mood":"happy"}` renders `neutral`. The next click goes to `happy` and stores `"happy"`.
- `shared-marks`: one click on the first of the 8 marks on `/design/auth` turns all 8 to `happy`.
- `cross-tab`: a click in tab A turns tab B (same browser profile) to `happy` without a reload.

## How to get to it (user POV)

- Click the mark, then reload the page or open another route that shows the mark.
- Keep two tabs of the app open and click the mark in one.

## Driving it with brand.sh

Preconditions:

- A fresh context for each check. Tab B in `cross-tab` shares tab A's context.

- **Persist.** Run `brand.sh check --only persist-reload`. The facts show the stored value `"love"` and the mood after reload `love`. The run saves `persist-after-reload.png`.
- **Stale values.** Run `brand.sh check --only stale-storage`. All three stored values show `neutral`, and the first click gives `happy`.
- **Shared and cross-tab.** Run `brand.sh check --only shared-marks,cross-tab`. The run saves `shared-marks.png`, showing 8 marks in the same mood.
- **SSR.** Run `brand.sh check --only ssr-neutral`. This is plain HTTP and needs no browser.

## Gotchas

- The flicker after a reload, from `neutral` to the stored mood, is expected behaviour. A cookie would be needed to make the server render the stored mood.
- `stale-storage` is the only check that writes storage directly. It stands in for a value left by an older build.
- Cross-tab sync uses the `storage` event, which fires only in other tabs. Tab A updates through its own state.
