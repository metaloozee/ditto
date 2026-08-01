# Design: Composer narrow-width card morph

**Date:** 2026-08-01  
**Status:** Approved  
**Component:** `apps/web/src/components/composer.tsx`  
**Context:** Chat column can shrink below a comfortable width on small
viewports or when the desktop tools/preview rail is wide. The composer keeps a
fixed three-column row (model · textarea · send) with thinking absolutely
positioned inside the field (`pr-24`). At tight widths the row looks stubby,
placeholder text clips, and thinking crowds the input.

## Goal

Preserve the current wide layout and visual language. When the **composer’s own
container** is narrow, smoothly morph into a single card: textarea on top,
controls on a bottom bar. Adaptation only — not a redesign.

## Non-goals

- Changing the wide (≥ threshold) layout or control set
- Viewport-only / `useIsMobile` triggering (misses tools-rail squeeze)
- New features, new controls, or chat/tools pane layout changes
- Redesigning model selector, thinking select, or submit/stop behavior

## Layout

### Wide (container ≥ ~420px) — unchanged

```
[ Model 44 ] [ textarea  +  thinking (absolute, end) ] [ Send 44 ]
```

- Circular outline model button (`size-11`)
- Pill textarea (`rounded-3xl`, `min-h-11`, `pr-24` for thinking)
- Thinking `Select` absolutely positioned bottom-right inside the field
- Circular submit/stop (`size-11`)
- Horizontal `gap-2` between the three columns

### Narrow (container < ~420px) — card morph

```
┌─────────────────────────────────────────────┐
│  textarea (full width, no side chrome)      │
│  …grows upward with content…                │
│                                             │
│  [Model 36]  Thinking ▾        ···   [↵ 36] │
└─────────────────────────────────────────────┘
```

Bottom bar order (confirmed): **Model · Thinking · flex spacer · Send**

Rules:

- One surface: same card tokens as today’s pill (bg, border, radius, shadow)
- No external side columns (reclaims ~96px of horizontal chrome)
- Textarea is full inner width; drop the wide-mode `pr-24` reservation
- Bottom bar is a fixed-height footer inside the card; text never sits under
  controls
- Inner circular controls use 36px (`size-9`) so the bar stays compact while
  remaining tappable
- Thinking remains the same `Select` with the same labels; only its slot moves
- Section shell stays `w-full min-w-0 max-w-3xl` with existing horizontal page
  padding so flex shrink from the tools rail cannot overflow

## Trigger

Use a **CSS container query** on the composer shell (e.g.
`@container` / Tailwind `@[…]:` variants), not viewport breakpoints and not
`useIsMobile`.

- Query subject: the composer section (or an inner wrapper that is the full
  chat-column width available to the form)
- Threshold: approximately **420px** content width (tune ±20px during
  implementation if the morph feels early/late against real tools-rail sizes)
- Rationale: the reported failure mode is “small screen **or** right panel large
  enough”; only container width covers both

## Motion

When crossing the threshold:

1. **Shell** — three-column row becomes one bordered card (tokens already match
   the pill).
2. **Model + send** — move from outside flanks into the bottom bar (short
   translate + opacity, ~180–220ms ease-out).
3. **Thinking** — leaves the absolute field corner and settles on the bottom bar
   left of the spacer.
4. **Textarea** — padding switches from wide (`pr-24`, single-line vertical
   center) to card (normal inline padding + bottom inset clear of the bar).

`prefers-reduced-motion: reduce`: instant layout swap, no translate/fade.

Implementation should prefer CSS (container queries + transitions) over JS
layout measurement. JS is acceptable only if a11y focus management requires it;
do not drive the breakpoint with `ResizeObserver` unless CSS proves
insufficient.

## Behavior parity

All existing composer behavior is unchanged across both layouts:

- Enter-to-send / Shift+Enter newline
- Submit, stop, queue-follow-up, pending/spinner states
- Model selector open/close, disabled while streaming
- Thinking level select, disabled rules, labels
- Tooltips and `aria-*` labels on model and submit
- Error text under the form
- Safe-area bottom padding on the section

Focus order in narrow mode should remain sensible: textarea → model → thinking
→ send (or native tab order of the restructured DOM). Do not trap focus.

## Markup approach

Restructure the form shell so both layouts share one DOM tree where practical
(avoid mounting two complete composers). Preferred shape:

```
section[@container]
  form
    .composer-shell   // row when wide; column card when narrow
      .composer-input // textarea (+ wide-only absolute thinking slot)
      .composer-controls
        model | thinking | send
```

Wide layout can position model/send as flex siblings via CSS (order /
absolute / grid areas). Narrow layout stacks input over the controls row.
Exact CSS technique is an implementation detail; the visual result and single
behavior path are not.

Do not duplicate submit handlers or streaming state for the two layouts.

## Testing

Keep coverage light and focused:

- Existing `composer.test.tsx` behavior still passes (submit, disabled, stop /
  queue labels).
- Add or extend one test only if markup changes break queries; prefer
  role/label selectors that work in both layouts.
- No visual-regression suite required for this change.
- Manual check: resize chat column with tools rail open/closed; confirm morph
  threshold, no horizontal overflow, multi-line text clears the bottom bar,
  reduced-motion instant swap.

## Files

| File | Change |
|------|--------|
| `apps/web/src/components/composer.tsx` | Shell markup + responsive classes / container query |
| `apps/web/src/components/composer.test.tsx` | Only if selectors need updating |

No route, store, or API changes.

## Success criteria

1. At comfortable chat widths the composer looks as it does today.
2. At tight widths (viewport or tools rail) it becomes the card layout without
   clipped placeholder, overlapping thinking control, or horizontal scroll.
3. Morph is smooth under normal motion preferences and instant under reduced
   motion.
4. Model · Thinking · Send order on the bottom bar; send remains the primary
   trailing action.
5. Streaming submit/stop/queue and model/thinking interactions work identically
   in both layouts.
