---
version: alpha
name: Ditto
description: Design system for Ditto, a dark-first workspace for running sandboxed coding agents. Built on shadcn (base-nova style) with Base UI primitives and HugeIcons.
colors:
  background: "#1e1e1f"
  sidebar: "#19191a"
  card: "#222223"
  panel: "#272728"
  popover: "#272728"
  muted: "#2d2d2f"
  accent: "#2d2d2f"
  sidebar-accent: "#272728"
  border: "#353537"
  panel-border: "#3e3e40"
  input: "#828386"
  field: "#19191a"
  foreground: "#f3f3f4"
  muted-foreground: "#c0c1c3"
  primary: "#f3f3f4"
  on-primary: "#19191a"
  signal: "#5884f8"
  ring: "#5884f8"
  link: "#9fbdff"
  success: "#75d78d"
  destructive: "#fda19a"
  light-background: "#fdfdfe"
  light-sidebar: "#f7f8f9"
  light-card: "#f7f8f9"
  light-panel: "#fdfdfe"
  light-popover: "#fdfdfe"
  light-muted: "#f2f2f4"
  light-accent: "#f2f2f4"
  light-sidebar-accent: "#ebebec"
  light-border: "#dddee0"
  light-panel-border: "#dddee0"
  light-input: "#858689"
  light-field: "#f7f8f9"
  light-foreground: "#161617"
  light-muted-foreground: "#626366"
  light-primary: "#161617"
  light-on-primary: "#fdfdfe"
  light-signal: "#2f5ae8"
  light-ring: "#2f5ae8"
  light-link: "#2f5ae8"
  light-success: "#137738"
  light-destructive: "#b32228"
typography:
  display:
    fontFamily: Inter Variable
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.02em
  title:
    fontFamily: Inter Variable
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.01em
  heading:
    fontFamily: Inter Variable
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: Inter Variable
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Inter Variable
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: Inter Variable
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.4
  code:
    fontFamily: JetBrains Mono Variable
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  card: 16px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 40px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 12px
  button-secondary:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 12px
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 12px
  button-outline-hover:
    backgroundColor: "{colors.accent}"
  button-ghost:
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 12px
  button-ghost-hover:
    backgroundColor: "{colors.muted}"
  button-link:
    textColor: "{colors.link}"
    typography: "{typography.label}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 10px
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: 6px
  card-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 16px
  card-footer:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 16px
  popover:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 4px
  badge:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    height: 20px
    padding: 8px
  tooltip:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
  sidebar:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.foreground}"
    width: 256px
  sidebar-item:
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 8px
  sidebar-item-active:
    backgroundColor: "{colors.sidebar-accent}"
    textColor: "{colors.foreground}"
---

## Overview

Ditto is a quiet, dark-first tool for watching and steering coding agents. The interface is charcoal and near-white, with one blue reserved for signal: focus, links, and work in progress. The main call to action is a light button on a dark surface, never a colored one, so the eye goes to content and to what the agents are doing. Density is moderate: 14px text, 32px controls, 36px navigation rows.

The brand mark is a white rounded bezel around a dark screen with two blue strokes (`#9fbdff` over `#5884f8`, the signal blue). Source: `apps/web/public/logo.svg`, served at `/logo.svg` and used as the SVG favicon. `favicon.ico` (16, 32, 48) and `apple-touch-icon.png` (180, on the dark background) are rendered from it; regenerate both when the mark changes.

Dark is the default. The app follows the operating system's appearance, and every token has a light counterpart (the `light-` prefixed colors above).

The system is shadcn's `base-nova` style generated on Base UI primitives, so behaviour (focus management, keyboard support, ARIA) comes from Base UI and the visuals come from these tokens. Source of truth: `apps/web/src/styles.css` for tokens and `apps/web/src/components/ui/` for components.

## Colors

Two ramps and three status colors. Neutrals carry almost every pixel; blue appears only where something is interactive or happening.

- **Sidebar (#19191a), background (#1e1e1f), card (#222223), panel (#272728):** surfaces step lighter as they come forward, in small even steps. Nothing is darker than #19191a; the darkest plane is charcoal, not black. Popovers share the panel color.
- **Foreground (#f3f3f4):** body text and headings.
- **Muted foreground (#c0c1c3):** supporting text, labels, metadata.
- **Edge (white at 8%, 13% on hover):** the outline button's 1px edge (`border-(--edge)`). In light mode it's black at the same alphas.
- **Border (#353537):** decorative hairlines, dividers, and the card shell's edge.
- **Panel border (#3e3e40):** the edge of panels inside a card. One step stronger than `border`, so nested panels stay distinct on the shell.
- **Input (#828386):** the edge of checkboxes and the unchecked switch track, which need a 3:1 boundary.
- **Field (#19191a) with field edge (white at 10%, 16% on hover):** text inputs, textareas, and selects. The fill is one step below the page so the field reads as sunken, with a 2px inner top shadow. The resting edge is deliberately quiet and does not reach 3:1; the sunken fill, the label, and the blue focus edge carry the affordance. Light mode: #f7f8f9 with black at 10%.
- **Primary (#f3f3f4) on on-primary (#19191a):** the one filled call to action per view.
- **Signal (#5884f8):** running-state indicators. **Ring** uses the same blue for focus.
- **Link (#9fbdff):** link text. Lighter than signal, so link text clears 4.5:1 with room to spare on every dark surface.
- **Success (#75d78d) and destructive (#fda19a):** text color for positive and negative deltas, errors, and destructive actions. Destructive buttons use the color as a 10–20% tint behind destructive text, not as a solid fill.

Neutrals are OKLCH with chroma at or below 0.004 (hue 275), so they read as neutral charcoal. In code, components use semantic tokens (`bg-card`, `text-muted-foreground`, `bg-signal`); the numbered primitives (`--gray-*`, `--blue-*`) exist only inside `styles.css`.

Measured contrast, WCAG 2 and APCA, in both modes, against every surface each color renders on (page, sidebar, card, panel, hover): body text ≥ 12.4:1; muted text ≥ 5.4:1 (dark |Lc| ≥ 64); link text ≥ 5.5:1; success and destructive text ≥ 5.5:1 (dark |Lc| ≥ 60); checkbox and switch edges ≥ 3.4:1; button labels ≥ 7.6:1 on every stop of their gradients; field text ≥ 15.8:1 and placeholders ≥ 5.6:1 on the field fill; focus ring ≥ 4.3:1; primary button label ≥ 15.8:1.

## Typography

Inter Variable for the interface, JetBrains Mono Variable for code, paths, branch names, and IDs. Both are self-hosted through Fontsource.

| Role    | Size | Line height | Weight | Tracking | Tailwind              |
| ------- | ---- | ----------- | ------ | -------- | --------------------- |
| Display | 32px | 1.1         | 600    | -0.02em  | `text-display`        |
| Title   | 24px | 1.2         | 600    | -0.01em  | `text-title` (h1)     |
| Heading | 16px | 1.3         | 600    | 0        | `text-heading` (h2)   |
| Body    | 14px | 1.5         | 400    | 0        | `text-body` (default) |
| Caption | 13px | 1.4         | 400    | 0        | `text-caption`        |

- Display is for large numbers such as stat values. Pair it with `tabular-nums`.
- Emphasis inside a role is one weight step (400 → 500), not a size change.
- Headings use `text-wrap: balance`; paragraphs use `text-wrap: pretty`.
- Text inputs render at 16px below the `md` breakpoint so iOS Safari does not zoom, and at 14px above it.
- Font smoothing is set once on the root (`antialiased`).

## Layout

- 4px base unit (Tailwind spacing). Common steps: 4, 8, 12, 16, 24, 32, 40.
- App shell: a 256px sidebar on the left, with the main panel inset by 8px and rounded 14px (`Sidebar variant="inset"`). Under 768px the sidebar becomes a sheet behind a trigger.
- Page content: centered, `max-w-5xl`, 16px side gutters on mobile and 32px from `sm` up, 40px top padding, 40px between sections. A single column of settings narrows to `max-w-2xl` so rows stay readable.
- Section header: a heading-role title, optionally followed by an info icon with a tooltip.
- Grids collapse to two columns, then one, on narrow screens. The page never scrolls horizontally.
- Auth screens (`/sign-in`, `/sign-up`): one left-aligned `max-w-sm` column centered on the page, with the mark, a title, a muted line, then the step. The email form comes first, with the primary button. GitHub and Google follow as `secondary` buttons, then a centered line that switches between sign-in and sign-up. Notices sit above the form. Each step is its own screen, never a dialog: the step and any redirect message live in search params (`?step=verify`, `?notice=…`, `/settings?outcome=…&method=…`), so back and refresh work, while what the visitor typed rides in history state, never the URL. Linking email in Settings is its own screen too (`/settings/verify-email`). Every state is drawn at `/design/auth`; `apps/web/src/components/auth.tsx` and `account.tsx` hold the screens.

## Elevation & Depth

Depth comes from surface lightness and hairlines, not shadows.

- Cards nest: a shell one step lighter than the page with a `border` edge, holding panels one more step lighter with a `panel-border` edge. The gap between panels and the shell's inset are both 6px, so the shell reads as a frame.
- Floating surfaces (menus, select popups) use the popover color, the same ring, and a medium shadow.
- Dialogs sit over a dimmed backdrop.
- Never more than two floating layers at once. A third layer means a dialog.

## Shapes

- Buttons use 10px (`rounded-lg`), icon buttons too. Badges and switches are the only pills.
- Base radius 10px. Inputs, selects, tabs, and menus use 10px (`rounded-lg`).
- Card panels use 10px. The card shell uses 16px: the panel radius plus the shell's 6px inset, so the corners stay concentric.
- Dialogs use 14px (`rounded-xl`).
- Tooltips and sidebar items use 8px. Checkboxes use 4px.
- Badges and switches are fully rounded.
- Nested surfaces: outer radius = inner radius + padding.

Icons come from HugeIcons (`@hugeicons/react` with `@hugeicons/core-free-icons`), stroke style, 16px in controls and navigation and 14px in dense rows. Icons take the color of their text; decorative icons beside a label stay muted.

Provider logos (GitHub, Google) are not in HugeIcons. `BrandIcon` (`apps/web/src/components/brand-icons.tsx`) draws them from Simple Icons paths: single color, `fill: currentColor`, so they follow the same color and size rules as HugeIcons. Never use multicolor brand marks.

## Motion

Short, ease-out, and only on the properties that change.

- **Easing:** `ease-out`, `cubic-bezier(0, 0, 0.2, 1)`, for everything that responds to the user. Nothing eases in.
- **Durations:** 150ms for color changes, 200ms for hover and press, 300ms for something entering the page. Menus, selects, and tooltips open in 100ms, since they answer a click directly.
- **Press:** buttons scale to 0.97 on `:active` (not on menu triggers or disabled buttons). `will-change: transform` is set in advance so the press doesn't repaint.
- **Name the properties.** Transition `scale, color, background-color, box-shadow`, never `all`, so layout changes never animate by accident.
- **Hover on layered buttons** is a `filter: brightness()` step (darker on the white CTA, lighter on dark fills) inside the same 200ms transition, since a gradient fill can't interpolate.
- **Icon morph (copy → check):** both icons stay mounted in one grid cell. The outgoing one shrinks to `scale(0.25)`, blurs 4px, and fades; the incoming one does the reverse, over 300ms on `cubic-bezier(0.23, 1, 0.32, 1)`. Reduced motion keeps only the fade. A label beside it morphs letter by letter with torph (`TextMorph`, same duration and curve).
- **Character motion (the Ditto mark):** the mark is a character, so it is the one place with a delight budget, and it appears only where people meet the brand (`/design`, the sign-in and sign-up screens, and the signed-in home's empty state), never on work surfaces such as session lists or chat. It follows character rules, not the UI timing above:
  - **One loop, not CSS transitions.** A single `requestAnimationFrame` loop (`createDitto` in `apps/web/src/components/ditto-mark.tsx`) writes SVG `transform` attributes through refs. The step caps at 64ms, and an `IntersectionObserver` stops the loop offscreen.
  - **Eyes lead, the body follows.** The eyes snap to the gaze in about 60ms on an exponential ease that never overshoots. The body leans and rotates (up to 4°) toward the same gaze on a spring (stiffness 260, damping 24), so it arrives about 250ms later.
  - **Eyes sit on a sphere.** Gaze becomes a yaw and pitch, and the eyes narrow as they turn toward an edge. They never slide flat, and they are clipped to the screen.
  - **Never still.** The body breathes 1.2% on a 3.4s cycle and floats. Blinks are a quiet background detail, never a show: each one shuts in 90ms, stays shut for 50ms and opens over 140ms (280ms in all). The first comes 1.5–3s after load, the rest 3.5–7s apart, and 12% are doubles. After 2.5s without the pointer, the eyes glance to a new spot every 1.5–4s, and 30% of big glances bring a blink. Touch pointers are not followed.
  - **Press is physical.** Pointer down squashes the body to 0.92 from its base. Release stretches it and hops it about 5px on a bouncy spring (stiffness 300, damping 16).
  - **Moods change behind a blink.** Clicking the mark moves it to the next mood. The new eye shape swaps in while the lids are shut, so no crossfade is needed. A mood is one entry in `MOODS`: one path per eye, plus `weight` and `fill` for shapes that clog at full stroke width (hearts, crosses). Current moods: neutral, happy, love, surprised, wink, angry, sad, dizzy, sleepy.
  - **Keep these choices.** They were tuned by hand. Change the mark's motion model or its numbers only when the user asks. Never go back to eyes sliding flat on one spring, a crossfade between moods, a body that holds still, or blinks that are fast and frequent: the user rejected each one as unnatural or too aggressive. To add a mood, add an entry to `MOODS`; never add a separate drawing or a new animation path.
  - **Accessible and reduced.** The mark is a real `<button>` whose label names the current mood. Under reduced motion the loop never starts: the mark holds its resting pose and a click swaps the mood instantly.
- **Validation:** forms validate in the page (`noValidate`, TanStack Form), never with browser bubbles. Messages appear after the first submit and then update as the user types. A failed submit shakes each invalid field once (6px, decaying, 320ms on `cubic-bezier(0.23, 1, 0.32, 1)`), turns its edge red, and focuses the first one. Reduced motion drops the shake and keeps the rest.
- **Reduced motion:** looping animations, such as the running-state ping, stop under `prefers-reduced-motion`. A press scale is under 3% and stays.

## Components

All components live in `apps/web/src/components/ui/` and are generated by the shadcn CLI (`components.json`: style `base-nova`, icon library `hugeicons`, aliases `#/…`). Add new ones with `npx shadcn@latest add <name>` from `apps/web`. If the CLI asks to overwrite an existing file, say no, because some files carry the local edits listed below.

- **Button:** layered, after physical buttons. Four layers: a fill lit from the top (vertical gradient), a 1px edge (the button's own border), a 1px inner highlight along the top edge, and a soft drop shadow. `default` is the white CTA (`layer-primary`: white to #d4d4d5 with a #868687 edge and a 1px inner shade along the bottom, since a highlight can't show on white; near-black #525254 to #161617 in light mode), `secondary` is a raised neutral (`layer-raised`), `outline` is a flat card-colored button with an alpha edge, `destructive` is a red tint with a red edge, plus `ghost` and `link`. Sizes `xs` 24px, `sm` 28px, `default` 32px, `lg` 36px, plus square `icon` sizes. Mark an icon's position with `data-icon="inline-start"` or `"inline-end"`. Pressing scales to 0.97. Every button has `cursor: pointer` from its base class, so components built on `Button` or `buttonVariants` get it automatically; disabled and loading buttons ignore the pointer.
  - `loading`: the content goes transparent but stays laid out, so the width holds, and a loading.dev `Ring` (16px, `currentColor`) is centered over it. The button gets `aria-busy` and ignores clicks; its label stays the accessible name.
- **CopyButton** (`copy-button.tsx`): copies `value`, morphs the copy icon into a check, and resets after 1.6s. Icon-only by default (`aria-label` "Copy"/"Copied"); pass `label` for a text button whose label morphs to "Copied" with torph. A polite live region announces "Copied to clipboard". If the clipboard write fails, nothing changes.
- **Loaders:** from loading.dev (`loading-dev`). Every loader takes `size`, `color`, and `duration`, and respects reduced motion. Use `color="currentColor"` so it follows the text. `Ring` is the default in buttons; `LinearDots` suits inline text; `Blocks` and `Pulse` suit empty panels.
- **Input, Textarea, Select:** 32px tall, sunken `field` fill with a quiet alpha edge and an inner top shadow (`field` utility), blue edge and soft ring on focus, destructive edge on `aria-invalid`.
- **Checkbox and Switch:** filled with `primary` when checked.
- **Card:** a shell (`Card`) holding panels. `CardPanel` is the inner surface; put `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, and `CardContent` inside it. `CardFooter` is its own panel with centered actions. Panels stack in a column by default; wrap them in a grid for side-by-side panels, or use one panel per row for lists. `size="sm"` tightens panel padding from 16px to 12px.

  ```tsx
  <Card>
    <CardPanel>
      <CardHeader>
        <CardTitle>ditto/web</CardTitle>
        <CardDescription>2 agents running on main</CardDescription>
      </CardHeader>
      <CardContent>…</CardContent>
    </CardPanel>
    <CardFooter>
      <Button variant="outline" size="sm">
        Stop agents
      </Button>
    </CardFooter>
  </Card>
  ```

- **InputOTP** (`input-otp.tsx`): one-time codes, adapted from Kobra's input-otp onto these tokens. Six sunken `field` slots, 48px tall, digits in JetBrains Mono. One 2px ring in `ring` blue slides between slots as focus moves, and turns `destructive` on `aria-invalid`. Digits flip in, a paste leaves a fading trail across the slots it filled, a full code dims in a wave while it's checked, and `success` sweeps the row in `success` and hops each digit. The form submits when the last digit lands; a rejected code shakes the row and clears it. Built on `input-otp` and `motion`; keyframes live in `styles.css` (`otp-*`). Reduced motion keeps the colors and drops the motion.
- **Alert:** a bordered notice with an icon, title, and description. `default` for neutral news, `success` for a finished action (green icon and title stays foreground), `destructive` for a failure (red tint and edge, like the destructive button). It has `role="alert"`; pass `role="status"` for news that isn't a problem.
- **Badge:** 20px pill, 12px medium text. `secondary` for neutral states, `destructive` for failures, `default` for the rare emphasized state.
- **Dialog, Dropdown menu, Tooltip, Tabs, Separator, Label, Avatar, Kbd, Breadcrumb, Sheet, Skeleton, Sidebar:** shadcn defaults on the tokens above.
- **Sidebar:** 256px, 36px rows, active row filled with `sidebar-accent`, group labels in caption size.

Running state: an 8px `signal` dot with a ping animation, which `motion-reduce` turns off.

Local edits to generated files:

- The `link` variants of `button.tsx` and `badge.tsx` use `text-link` instead of `text-primary`.
- The default `SidebarMenuButton` size in `sidebar.tsx` is 36px (`h-9`) instead of 32px.
- `button.tsx` uses the layered variants (`layer-primary`, `layer-raised`), `rounded-lg`, the 0.97 press, and a `loading` prop.
- `input.tsx`, `textarea.tsx`, and `select.tsx` use the `field` utility instead of `border-input` and the gray tint.
- `card.tsx` is rewritten as the shell-and-panel card, with a new `CardPanel` export. Never let the CLI overwrite it.
- `alert.tsx` adds the `success` variant and gives `destructive` a red tint and edge.

## Do's and Don'ts

- **Do** fill exactly one action per view with `primary`. Other actions in the same view use `secondary`, `outline`, or `ghost`.
- **Do** use blue only for focus, links, and running state. Status meaning comes from `success` and `destructive` plus an icon or a label, never from color alone.
- **Do** use semantic tokens in components. **Don't** use raw hex, `oklch()` literals, or `--gray-*` and `--blue-*` primitives outside `styles.css`.
- **Do** pick the delta arrow from the number's direction and the color from whether that direction is good. A faster run time is a green down arrow.
- **Do** set `tabular-nums` on counters, timers, and numeric columns.
- **Do** keep text at weight 400 or heavier.
- **Don't** add a second accent hue. Use more neutral steps instead.
- **Don't** use `primary` as a text color for links. Use `link`.
- **Don't** use shadows to separate in-flow content. Use a surface step or a hairline.
- **Don't** put content directly in a `Card` shell. Put it in a `CardPanel`.
- **Don't** use pure black or anything darker than the sidebar (#19191a) in dark mode.
- **Don't** give text fields a solid gray edge. Use the `field` utility. Checkboxes and switches keep `input`.
- **Don't** put a solid accent fill on more than one button per view. Layered `secondary` is for the second action.
- **Don't** transition `all`. Name the properties.
- **Don't** create a new color without measuring it against every surface it renders on, in both modes.
