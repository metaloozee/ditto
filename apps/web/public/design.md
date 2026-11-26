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
  bubble-received: "#272728"
  bubble-sent: "#2f5ae8"
  on-bubble-sent: "#f3f3f4"
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
  light-bubble-received: "#f2f2f4"
  light-bubble-sent: "#2f5ae8"
  light-on-bubble-sent: "#fdfdfe"
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
shadows:
  stage-drop: "drop-shadow(0 1px 1px oklch(0 0 0 / 28%)) drop-shadow(0 6px 14px oklch(0 0 0 / 14%))"
  screen-inset: "inset 0 2px 12px oklch(0 0 0 / 35%)"
  light-stage-drop: "drop-shadow(0 1px 1px oklch(0 0 0 / 12%)) drop-shadow(0 6px 14px oklch(0 0 0 / 8%))"
  light-screen-inset: "inset 0 2px 12px oklch(0 0 0 / 12%)"
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
  bubble-received:
    backgroundColor: "{colors.bubble-received}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
  bubble-sent:
    backgroundColor: "{colors.bubble-sent}"
    textColor: "{colors.on-bubble-sent}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
---

## Overview

Ditto is a quiet, dark-first tool for watching and steering coding agents. The interface is charcoal and near-white, with one blue reserved for signal: focus, links, work in progress, and the owner's own messages. The main call to action is a light button on a dark surface, never a colored one, so the eye goes to content and to what the agents are doing. Density is moderate: 14px text, 32px controls, 36px navigation rows.

The brand mark is a white rounded bezel around a dark screen with two blue strokes (`#9fbdff` over `#5884f8`, the signal blue). Source: `apps/web/public/logo.svg`, served at `/logo.svg` and used as the SVG favicon. `favicon.ico` (16, 32, 48) and `apple-touch-icon.png` (180, on the dark background) are rendered from it; regenerate both when the mark changes.

The code email (`codeMessage` in `apps/web/src/lib/code-message.ts`, previewed at `/design/auth`; `email.ts` only sends it) carries the brand too: a light card on the light tokens, the mark at 48px, and the code in a dark screen (`#19191a`, 16px radius) with digits in the mark's eye blue `#9fbdff`, JetBrains Mono at 36px. The mark travels as an inline PNG attachment (`email-mark.png`, 96px, rendered from `logo.svg`; regenerate it with the others), since mail clients render neither SVG nor data URLs. The subject leads with the code (“482913 is your Ditto code”) and the body shows it once as one unbroken string, so Gmail offers to copy it.

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
- **Bubble received (#272728) and bubble sent (#2f5ae8):** conversation bubbles. A bot's message sits one surface step above the page with a `panel-border` hairline. The owner's is the deep signal blue in both modes (light mode's `signal`, `--blue-8` in dark), so your own words read as yours at a glance. Dark-mode `signal` (#5884f8) is too light for light text (3.5:1) and dark text on it reads poorly, so the bubble takes the deeper step. Light mode: #f2f2f4 and #2f5ae8. Received text is `foreground` (13.5:1 dark, 16.2:1 light). Sent text is `on-bubble-sent`: #f3f3f4 dark (5.05:1) and #fdfdfe light (5.51:1). The dark-mode bubble sits at 2.97:1 against the page; its text, not its edge, identifies it.
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
- Auth screens (`/sign-in`, `/sign-up`): one left-aligned `max-w-sm` column centered on the page, with the mark, a title, a muted line, then the step. The email form comes first, with the primary button. GitHub and Google follow as `outline` buttons 16px apart, then a centered line that switches between sign-in and sign-up. On `/sign-in` only, the method this browser last signed in with gets a `default` “Last used” badge straddling its button's top edge at the inline end (12px in). On the primary button, whose fill matches the badge, a 2px `background` ring cuts it out; on `outline` buttons the opaque badge covers the border by itself, so no ring shows against their fill or hover. The buttons keep their variants, order and centered labels, so the email button stays the one primary. The badge comes from Better Auth's last-login-method cookie, read during SSR, so it never pops in. Linking a method in Settings doesn't move it. Feedback from a redirect arrives as a toast. Each step is its own screen, never a dialog: the step and any redirect message live in search params (`?step=verify`, `?notice=…`, `/settings?outcome=…&method=…`), so back and refresh work; a `notice` or `outcome` shows once as a toast and then leaves the URL, while what the visitor typed rides in history state, never the URL. Linking email in Settings is its own screen too (`/settings/verify-email`). Every state is drawn at `/design/auth`; `apps/web/src/components/auth.tsx` and `account.tsx` hold the screens.

- Failed provider sign-in shows an error toast with an option to try again or choose another method. Failed sign-out keeps the current screen open and shows a retry message.

- Signed-in home (`/`) is the owner's workspace, three panes on `SidebarProvider` (`apps/web/src/components/workspace.tsx`; every state at `/design/workspace`):
  - **Sidebar:** shadcn's sidebar, `variant="inset"`, `collapsible="icon"`. Collapsed, it's a rail of 40px bot faces; expanded (16rem), each face gets its name and role, like a list of people. Ditto, the Chief of Staff, is first, then the Bots group (New bot, disabled until bots arrive), then the account menu in the footer (initials, name, email; Settings and Sign out). Face rows are 56px tall with 14px corners, and the active row uses `background` with `shadow-sm`, the same surface and curve as the inset main panel, so the bot you're in reads as part of its page. The pin action sits at the end of the Ditto row and shows on hover or focus: “Collapse sidebar” when pinned, “Keep sidebar open” when peeking (⌘B does the same). Collapsed, the pointer reaching the rail, or focus moving in, opens it at once over the page without moving it (`peeking`: a ring, `shadow-lg`, 14px corners) until the pointer has been gone 200ms. There is no rail toggle bar along its edge. The pin persists in the `sidebar_state` cookie, read during SSR. Under 768px the sidebar is a sheet behind a trigger, the only trigger on the main screen.
  - **Conversation:** messages scroll the pane's full height under a floating header and composer, each backed by a progressive blur. The header centres the bot on its stage (`DittoStage`, 96px): a raised plate cut to the mark's own outline, lit like a secondary button (top-lit fill, `raised-edge` hairline, a highlight along the top rim that fades down the sides, a 1px contact shadow under a faint 14px ambient one), with the interactive mark on it. The plate leans toward the pointer on a softer spring than the body (stiffness 160, damping 22; up to 3px and 2.5°), so the two read as layers. The name is a `secondary` `Button` pill overlapping the plate's foot, then the role in caption. The name pill toggles the bot panel (`aria-expanded`, tooltip “Show computer”). The stage settles in from 0.9 scale with a 6px blur and the pill rises 90ms after it, 400–450ms on the strong ease-out. Messages sit in a `max-w-2xl` column. The composer is a floating 24px-radius pill on `popover` with a ring and `shadow-lg`: attach, a growing text field, and a round send button. It has four modes (`ComposerMode`): `soon` until conversation lands; `no-model`, disabled with the placeholder “Connect a model in Settings to message Ditto” when the owner has no usable connection and no included model; `ready`; and `running`, where Send becomes Stop. Send and Stop are one button whose icons morph (the icon morph below), so it reads as the same control changing what it does. Messages the owner sends while a turn is interrupted are sent bubbles with “Queued” in caption under them (`QueuedBubble`).
  - **Bot panel:** the panel that opens from the bot's face, docked from 1024px in a resizable split (384px by default, 300px to 55%; drag the handle or use arrow keys). The handle is a hairline with a 12px hit area and a 4px grip pill that grows and brightens on hover and while dragging, and a bottom drawer below that. `?panel=computer` holds it open across a refresh, set with `replace`. Its top row holds the computer's status badge (a muted dot when stopped, the signal ping when running) and, at the end, a ghost gear that opens the bot's settings. There is no "Computer" heading or bot name: the conversation already names the bot and the screen explains itself; the panel keeps the accessible name "Computer". Then the screen in a lit bezel over a sunken dotted display, and its controls as a three-column grid of tiles.
  - **States:** opening shows a skeleton in the final shape. A failed open replaces the page with a message and a Try again button that retries in place. Until conversation lands (#19), Ditto shows a fixed set of greetings, the same on every visit, and the composer and controls are disabled.
  - The page `h1` (“Welcome back, {display name}”, or “Welcome back”) is for screen readers; the bot's face and name lead visually.

- Email sign-in shows the same code screen for every submitted address. The description says a code is on its way only if the address has email sign-in, and when it expires. Every way out of the step sits under the code form: the resend line, then “Use a different email” and “Don’t have an account? Sign up” on one wrapping row. Other code steps say “Enter the code we sent to …” and keep the change-address action in the same row. The resend countdown starts when the request is accepted. An unusable code shows “That code didn’t work. Check it or request a new one.” While a new code is being sent, the code row, the submit button and “Send a new code” are disabled; the row clears when the new code is issued, and focus returns to it.

## Elevation & Depth

Depth comes from surface lightness and hairlines, not shadows.

- Cards nest: a shell one step lighter than the page with a `border` edge, holding panels one more step lighter with a `panel-border` edge. The gap between panels and the shell's inset are both 6px, so the shell reads as a frame.
- Floating surfaces (menus, select popups) use the popover color, the same ring, and a medium shadow.
- Dialogs sit over a dimmed backdrop.
- **Stage drop (`--stage-drop`):** a `filter` of two drop shadows, a 1px contact shadow under a faint 14px ambient one, that seats the Ditto stage's raised plate (`DittoStage`) on the page. It follows the plate's cut outline, which a `box-shadow` can't. Black at 28% and 14% dark, 12% and 8% light.
- **Screen inset (`--screen-inset`):** an inner 12px shadow from the top edge that sinks the computer's display into its bezel in the bot panel. Black at 35% dark, 12% light.
- Never more than two floating layers at once. A third layer means a dialog.

## Shapes

- Buttons use 10px (`rounded-lg`), icon buttons too. Badges and switches are pills, and so is the conversation's floating chrome: the bot's name pill, the composer (24px) and its round attach and send buttons.
- Base radius 10px. Inputs, selects, tabs, and menus use 10px (`rounded-lg`).
- Card panels use 10px. The card shell uses 16px: the panel radius plus the shell's 6px inset, so the corners stay concentric.
- Dialogs use 14px (`rounded-xl`).
- Tooltips and sidebar items use 8px. Checkboxes use 4px.
- Badges and switches are fully rounded.
- Nested surfaces: outer radius = inner radius + padding.

Icons come from HugeIcons (`@hugeicons/react` with `@hugeicons/core-free-icons`), stroke style, 16px in controls and navigation and 14px in dense rows. Icons take the color of their text; decorative icons beside a label stay muted.

Provider logos (GitHub, Google, OpenCode) are not in HugeIcons. `BrandIcon` (`apps/web/src/components/brand-icons.tsx`) draws them from Simple Icons paths: single color, `fill: currentColor`, so they follow the same color and size rules as HugeIcons. Never use multicolor brand marks. Simple Icons removed OpenAI's mark at OpenAI's request, so the ChatGPT plan uses HugeIcons' `ChatGptIcon`; the included model uses `SparklesIcon`.

## Motion

Short, ease-out, and only on the properties that change.

- **Easing:** `ease-out`, `cubic-bezier(0, 0, 0.2, 1)`, for everything that responds to the user. Nothing eases in.
- **Durations:** 150ms for color changes, 200ms for hover and press, 300ms for something entering the page. Menus, selects, and tooltips open in 100ms, since they answer a click directly.
- **Press:** buttons scale to 0.97 on `:active` (not on menu triggers or disabled buttons). `will-change: transform` is set in advance so the press doesn't repaint.
- **Name the properties.** Transition `scale, color, background-color, box-shadow`, never `all`, so layout changes never animate by accident.
- **Hover on layered buttons** is a `filter: brightness()` step (darker on the white CTA, lighter on dark fills) inside the same 200ms transition, since a gradient fill can't interpolate.
- **Icon morph (copy → check):** both icons stay mounted in one grid cell. The outgoing one shrinks to `scale(0.25)`, blurs 4px, and fades; the incoming one does the reverse, over 300ms on `cubic-bezier(0.23, 1, 0.32, 1)`. Reduced motion keeps only the fade. A label beside it morphs letter by letter with torph (`TextMorph`, same duration and curve).
- **Character motion (the Ditto mark):** the mark is a character, so it is the one place with a delight budget, and it appears where people meet the brand (`/design`, the sign-in and sign-up screens) and as the Chief of Staff's face in the workspace. In the conversation header it's the full character; in the sidebar it's `still`: the resting pose as a picture, no pointer following, no click, no loop. It follows character rules, not the UI timing above:
  - **One loop, not CSS transitions.** A single `requestAnimationFrame` loop (`createDitto` in `apps/web/src/components/ditto-mark.tsx`) writes SVG `transform` attributes through refs. The step caps at 64ms, and an `IntersectionObserver` stops the loop offscreen.
  - **Eyes lead, the body follows.** The eyes snap to the gaze in about 60ms on an exponential ease that never overshoots. The body leans and rotates (up to 4°) toward the same gaze on a spring (stiffness 260, damping 24), so it arrives about 250ms later.
  - **Eyes sit on a sphere.** Gaze becomes a yaw and pitch, and the eyes narrow as they turn toward an edge. They never slide flat, and they are clipped to the screen.
  - **Never still.** The body breathes 1.2% on a 3.4s cycle and floats. Blinks are a quiet background detail, never a show: each one shuts in 90ms, stays shut for 50ms and opens over 140ms (280ms in all). The first comes 1.5–3s after load, the rest 3.5–7s apart, and 12% are doubles. After 2.5s without the pointer, the eyes glance to a new spot every 1.5–4s, and 30% of big glances bring a blink. Touch pointers are not followed.
  - **Press is physical.** Pointer down squashes the body to 0.92 from its base. Release stretches it and hops it about 5px on a bouncy spring (stiffness 300, damping 16).
  - **Moods change behind a blink.** Clicking the mark moves it to the next mood. The new eye shape swaps in while the lids are shut, so no crossfade is needed. A mood is one entry in `MOODS`: one path per eye, plus `weight` and `fill` for shapes that clog at full stroke width (hearts, crosses). Current moods: neutral, happy, love, surprised, wink, angry, sad, dizzy, sleepy.
  - **Keep these choices.** They were tuned by hand. Change the mark's motion model or its numbers only when the user asks. Never go back to eyes sliding flat on one spring, a crossfade between moods, a body that holds still, or blinks that are fast and frequent: the user rejected each one as unnatural or too aggressive. To add a mood, add an entry to `MOODS`; never add a separate drawing or a new animation path.
  - **Accessible and reduced.** The mark is a real `<button>` whose label names the current mood. Under reduced motion the loop never starts: the mark holds its resting pose and a click swaps the mood instantly.
- **Easing tokens:** `ease-out-strong` is `cubic-bezier(0.23, 1, 0.32, 1)` for things entering or opening; `ease-drawer` is `cubic-bezier(0.32, 0.72, 0, 1)` for sheets and panels.
- **Sidebar:** expanding and peeking take 260ms and collapsing 180ms, both on `ease-out-strong`, never shadcn's linear 200ms. Menu buttons resize their padding on the same timing, so labels and the frame move together. Reduced motion drops the transition.
- **Conversation:** a message enters with a fade, an 8px rise, a 0.98 scale and a 4px blur, over 400ms on `cubic-bezier(0.23, 1, 0.32, 1)`, from its speaker's corner (`message-in`, delay through `--enter-delay`). A group arrives on uneven, tightening gaps (0, 70, 130, 180ms), never a fixed step. The docked panel slides 12px in from its edge (`panel-in`, 300ms, drawer curve). Reduced motion keeps everything in place.
- **Progressive blur** (`progressive-blur.tsx`): content passing under floating chrome blurs harder toward the edge, in three layers at 1px, 4px and 12px, each masked to one band of the gradient, with a tint to `background` on top. Use it under floating headers and composers, never as decoration. Every layer is a `backdrop-filter` that repaints whenever something moves near it, so keep it to three layers.
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
- **Toast** (`toast.tsx`): the result of an action or a redirect, reported at the bottom-end corner (bottom right, mirrored in RTL). Adapted from Kobra's toast onto these tokens. `/design` shows every state.

  - **Anatomy:** an optional mark, a one-line message, an optional description and an optional action. With only a message it's a slim 36px bar whose message truncates; a description morphs it into a card 340px wide (never wider than the viewport minus 32px) whose message wraps and turns medium weight. The surface is the floating one: `popover`, a 1px `foreground/10` ring, `shadow-md`, 14px radius (`rounded-xl`, like dialogs). An action is an `xs` primary button: at the end of the line on a bar, and on its own row under the description on a card, lined up with the text. The toast floats above the page as its own layer, so its one action may be primary even when the page has its own.
  - **States:**

    | `state`   | Mark                       | Role     | Lifetime                    | Use for                                       |
    | --------- | -------------------------- | -------- | --------------------------- | --------------------------------------------- |
    | none      | none                       | `status` | 2.4s                        | Quiet confirmations: "Branch name copied"     |
    | `success` | green check (`success`)    | `status` | 2.4s, 5s with a description | Finished actions: "Preview deployed"          |
    | `error`   | alert icon (`destructive`) | `alert`  | 5s with a description       | Failures nothing else on screen shows         |
    | `info`    | info icon (muted)          | `status` | 5s with a description       | Neutral news, such as where a redirect landed |
    | `pending` | loading.dev `Ring` (muted) | `status` | until resolved              | Work the user waits on                        |

    Any toast with an action stays 6s. All timers pause while the stack is hovered, focused or held, and while the tab is hidden.

  - **Behaviour:** new toasts enter at the front and older ones pile behind it, peeking 10px, shrinking 3% and fading per step, three deep. Pointing at, focusing or pressing the stack fans it into a column with 8px gaps. Drag a toast more than 44px, or flick it, to dismiss it. Changed text fades in from a 4px blur, letter by letter for messages and word by word for descriptions (joined scripts such as Arabic always go by word). The mark swaps with the icon morph (scale 0.25, 4px blur). Size changes use a 300ms spring with no bounce; exits take 200ms. Reduced motion keeps every toast and drops the motion.
  - **API:** `<Toasts />` is mounted once in `__root.tsx`. Call `toast("Message")` or `toast({ id?, message, description?, state?, action?: { label, run }, lifetime? })` from anywhere, including before `<Toasts />` mounts (early calls are queued). Reusing an `id` updates that toast in place, which is how `pending` resolves into `success` or `error`, and how one message replaces its earlier copy instead of stacking. `dismissToast(id)` removes one. An action dismisses its toast after running, unless the action itself toasts with the same id.
  - **Use it well:** one toast per outcome; reuse the id rather than stacking duplicates. Keep the message to a few words that name the result ("Google is linked"), and put the reason or next step in the description. Give an error a way forward, in the description or as an action such as Retry. Use at most one action, and keep anything critical somewhere else too, since the toast leaves on its own. A toast fired from a URL param (`?notice=`, `?outcome=`) shows once, then the param leaves the URL so a refresh won't repeat it.
  - **Don't** use a toast for validation, for an error the user must fix in place, or for something they need to read later. Those stay on the page beside what they're about.

- **Conversation** (`conversation.tsx`): adapted from Kobra's conversation onto these tokens. `Conversation` stacks one speaker’s messages 4px apart and leaves 16px where the speaker changes; `ConversationBubble` takes `variant="received"` (a bot, at the start) or `"sent"` (the owner, at the end); `ConversationContent` is the 18px-radius bubble (`rounded-2xl`, 16px by 10px padding). The corner nearest the speaker tucks to 8px, and so does the one a following message from the same speaker meets. Kobra's `tinted` variant (raw OKLCH), reactions and tap-to-reveal timestamps are left out.
- **Drawer** (`drawer.tsx`): Base UI's drawer as a bottom sheet on `popover`, 14px top corners, a grab handle, swipe to dismiss on the drawer curve. It bleeds 3rem below the screen so an overshooting swipe never shows a gap.
  - **Floating sheet** (`side="end"` with `swipeDirection="right"` on the root): a sheet from the inline end that floats 8px off the screen's edges with 14px corners, like the inset main panel, and never moves the page. It settles in like a message (`sheet-motion`: a fade, a 2rem slide from its edge, a 0.98 scale and a 4px blur over 420ms on `ease-out-strong`) and leaves the same way in 220ms. A swipe instead carries it off the edge at the speed of the flick (`data-swipe-dismiss`). The page dims behind it (black at 40%, 55% dark) so attention moves to it. No backdrop blur: a `backdrop-filter` over the Ditto mark's SVG layers mis-composites in Chrome. 26rem wide at most. Use it for settings that will grow; on phones the same content goes in the bottom drawer.
- **RadioGroup** (`radio-group.tsx`): shadcn's on Base UI's radio, drawn like the checkbox: an `input` edge, filled with `primary` when checked. Give each option its label and a caption line, and let the whole row take the hit area, filled with `muted` when checked.
- **Resizable** (`resizable.tsx`): shadcn's, on `react-resizable-panels`. Sizes in pixels are numbers; percentages are strings.
- **Model access** (`model-access.tsx`, every state at `/design/models`; the rules it reads live in `lib/model-access.ts`):
  - **State badge:** a connection's state as a `Badge` with a label, so colour never carries it alone. Connected: `success` dot. Refreshing: a 10px `Ring`. Limit reached and Unavailable: muted dot. Reconnect needed: `destructive` badge with the alert icon.
  - **Settings section:** below sign-in methods. The included model is one quiet caption line with a sparkle, absent when the operator hasn't enabled it. The section is a size container, so its rows follow the room they have, not the viewport. The default model sits in its own panel, label beside the pair select from a 28rem section and above it when narrower. Connections are one card, one panel per row like sign-in methods: a 32px tile with the provider mark, name, a caption (the state's detail, or the models), then the state badge and at most one action (Disconnect `outline`, Check again `outline` with loading, Reconnect `primary`). Under a 32rem section the badge and action wrap under the name, lined up with it. A detail listing models names three and counts the rest ("Model A, Model B, Model C and 11 more"). A ChatGPT plan the deployment doesn't offer is a muted row with no action. The last row, “Connect an OpenCode API key”, morphs in place into the key form (password field in mono, model, Connect and Cancel). A key the provider refuses stays in the field, which shakes and takes focus, and the reason replaces the field's note in `destructive` until the key changes. Disconnect shows only where the caller can disconnect. Disconnecting asks first in a dialog, a drawer on phones, with a `destructive` button.
  - **Pair select** (`PairSelect`): a field-styled trigger showing the pair's mark and “Model · Connection”. It opens a popover with a rail of connection marks on the left and, beside it, a search field, the chosen connection's models (a tick on the current one) and a status line. A connection that can't be used stays on the rail, dimmed with a dot (`destructive` for Reconnect needed) and says why instead of listing models. Search reaches every usable connection at once. The list opens scrolled to the chosen model, a truncated name shows in full on hover, and with no connections at all the popup says so and links to Model access. The popup sits on the trigger's own sunken `field` surface, so it reads as the field opened up, with `muted` rows for the active and chosen items. It enters with the same motion as the sheet, from its trigger (`pop-motion`: fade, 0.96 scale, 4px blur, 240ms on `ease-out-strong`, 150ms out), slower than other menus because it's a weightier choice. Its 14px corners hold 10px rows at a 4px inset, so the radii stay concentric.
  - **Bot settings** (`BotSettings`): the floating sheet on desktop, the bottom drawer on phones. A header with the bot's face (40px mark, name, role) and a close button, then a scrolling body of sections. For now one section, Model: “Use the default” or “Choose for this bot” with a pair select. Each option is one row (radio, label, caption, and an optional control such as the pair select) that takes the pointer and the tap, bleeding 10px past the text on both sides, filled with `muted` when checked. A press on the row's own control stays with that control. Changes apply from the bot's next turn, so there's no Save.
  - **Interruption card** (`InterruptionCard`): the site request's anatomy (head, optional body, actions; wide actions in a row with the primary first, narrow ones stacked full width). The head is the turn's pair with its state badge, the body the state's detail. Limit reached offers “Resume on {default pair}” (primary) only when the default differs from the turn's pair, plus Model settings. Unavailable offers Check again; Reconnect needed, Reconnect (primary, to Settings). The Resume label truncates inside the card, with the full pair on hover. Settled is a `success` tick and “Carried on with {pair}”, with no Undo, since a resumed turn can't be taken back.
- **Badge:** 20px pill, 12px medium text. `secondary` for neutral states, `destructive` for failures, `default` for the rare emphasized state.
- **Dialog, Dropdown menu, Tooltip, Tabs, Separator, Label, Avatar, Kbd, Breadcrumb, Sheet, Skeleton, Sidebar:** shadcn defaults on the tokens above.
- **Sidebar:** 256px, 36px rows, active row filled with `sidebar-accent`, group labels in caption size. The workspace's face rows are the exception: 56px, 14px corners, and the active one on `background` with `shadow-sm` to match the inset panel.

Running state: an 8px `signal` dot with a ping animation, which `motion-reduce` turns off.

Local edits to generated files:

- The `link` variants of `button.tsx` and `badge.tsx` use `text-link` instead of `text-primary`.
- The default `SidebarMenuButton` size in `sidebar.tsx` is 36px (`h-9`) instead of 32px.
- `button.tsx` uses the layered variants (`layer-primary`, `layer-raised`), `rounded-lg`, the 0.97 press, and a `loading` prop.
- `input.tsx`, `textarea.tsx`, and `select.tsx` use the `field` utility instead of `border-input` and the gray tint.
- `card.tsx` is rewritten as the shell-and-panel card, with a new `CardPanel` export. Never let the CLI overwrite it.
- `sidebar.tsx` opens in 260ms and closes in 180ms on `ease-out-strong` instead of linear 200ms, menu buttons and actions get `cursor-pointer`, and `Sidebar` takes `peeking`, which shows a collapsed sidebar at full width over the page while its gap stays collapsed.
- `resizable.tsx` replaces shadcn's grip with a small pill that grows and brightens on hover and drag, and widens the hit area to 12px.

## Do's and Don'ts

- **Do** report the outcome of an action or a redirect in a toast. Keep validation on the field it belongs to, and never use a toast for an error the user must fix in place.
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
