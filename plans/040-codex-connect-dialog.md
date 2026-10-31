# Plan 040: Codex connect dialog (layout A: modal)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the 040 row in
> `plans/README.md`, unless a reviewer dispatched you and said they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 44c5739..HEAD -- apps/web/src/lib/candidate-session-client.ts apps/web/src/components/nav-user.tsx apps/web/src/components/composer.tsx apps/web/src/components/ui/dialog.tsx apps/web/src/components/copy-button.tsx apps/web/src/lib/codex-credential-do.ts`
> 037 is expected to have changed `codex-credential-do.ts` and `candidate-session-client.ts`. Check that its `DeviceAuthStart` type and `pending` status match "Current state". Any other mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (UI only)
- **Depends on**: plans/037-codex-device-code-connection.md DONE
- **Category**: direction
- **Planned at**: commit `44c5739`, 2026-10-31. The maintainer chose layout A (modal) on 2026-10-31 and will implement it later.

## Why this matters

037 gives the server a device-code Codex sign-in, but the user has to see a code, go to OpenAI, enter it and come back. Today the "Connect" buttons call `runAction("connect")` and only show a toast on failure. On success nothing tells the user what to do. This plan adds one modal that walks the user through the sign-in and closes itself when the connection is live.

## Approved layout (maintainer decision, 2026-10-31)

```
┌──────────────────────────────┐
│ Connect Codex                │
│                              │
│   ABCD-1234        [Copy]    │
│                              │
│ [Open auth.openai.com ↗]     │
│ Waiting for approval… 14:32  │
└──────────────────────────────┘
```

States and copy (implement exactly; ask before changing words):

| State | Trigger | Body | Actions |
|---|---|---|---|
| Waiting | `connect` returned `DeviceAuthStart` | Code (large, monospace, `aria-label` with the characters spaced), "Waiting for approval…" and an mm:ss countdown to `expiresAt` | [Copy] (copies the code), [Open auth.openai.com ↗] (`verificationUri`, new tab, `rel="noopener noreferrer"`) |
| Connected | status query returns `connected` | none; the dialog closes | Toast "Codex connected." |
| Expired | countdown reaches 0, or status returns `disconnected` while open | "This code expired." | [Get a new code] (runs `connect` again) |
| Failed | status returns `reconnect_required` while open | "Sign-in didn't complete." | [Try again] (runs `connect` again) |
| Unavailable | `connect` fails with `codex_device_auth_unavailable` or `codex_hosted_auth_unverified` | "Codex sign-in isn't available right now." | [Close] |

Title is always "Connect Codex". Description, visually hidden but read by screen readers: "Enter this code on OpenAI to connect your ChatGPT subscription." The waiting line is in an `aria-live="polite"` region; the countdown itself is not announced every second.

Closing the dialog does not cancel the sign-in. If the user approves later, the connection still completes. Pressing Connect again starts a new code, and 037 retires the previous one by bumping the generation.

## Current state

- `apps/web/src/lib/candidate-session-client.ts:656-707`: `useCodexConnection({ statusEnabled })` returns `{ status, isPending, actionPending, runAction(action) }`. `runAction` calls `codexConnection({ data: { action } })` (a server function loaded lazily, lines 649-654). It throws `CandidateRequestError(status, code)` on non-200, shows an error toast in `onError`, and invalidates the `["codex-connection"]` and `["candidate-models"]` queries when settled. **It discards the successful response body**, so the code never reaches the UI today.
- `CODEX_CONNECTION_VIEWS` (`:633-646`) maps each `ConnectionStatus` to a label, an action and a verb. After 037 it also has `pending: { label: "Waiting for sign-in…", action: "connect", verb: "Get a new code" }`.
- After 037, `connect` returns HTTP 200 with `DeviceAuthStart = { status: "pending"; generation: number; userCode: string; verificationUri: "https://auth.openai.com/codex/device"; expiresAt: number }`, exported from `apps/web/src/lib/codex-credential-do.ts`, and `status` returns `{ status: "pending", generation }` while a sign-in is pending.
- Two entry points call `runAction("connect")`:
  - `apps/web/src/components/nav-user.tsx:25-51` (`CodexConnectionMenu`, in the user dropdown);
  - `apps/web/src/components/composer.tsx:1245-1254` (the candidate composer's notice "Connect Codex to send messages." with a [Connect] button).
- UI kit: `#/components/ui/dialog` exports `Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose` (Base UI). The exemplar for a controlled modal is `apps/web/src/components/new-project-dialog.tsx:189-240` (`<Dialog open={open} onOpenChange={…}>`, `DialogHeader` with `text-balance` title and `text-pretty` description, `DialogFooter`). `apps/web/src/components/copy-button.tsx` exports `CopyButton({ value, label = "Copy" })`; reuse it. Toasts: `import { toast } from "#/components/ui/toast"`, `toast.add({ description })`.
- Tests: component tests live next to components (`new-project-dialog.test.tsx` is the pattern). Run with `pnpm --filter @ditto/web test -- <file>`.

## Scope

**In scope:** `apps/web/src/components/codex-connect-dialog.tsx` (create), `apps/web/src/components/codex-connect-dialog.test.tsx` (create), `apps/web/src/lib/candidate-session-client.ts` (`useCodexConnection` only), `apps/web/src/components/nav-user.tsx`, `apps/web/src/components/composer.tsx` (the candidate notice's Connect button only).

**Out of scope:** server code, including `codex-connection*.ts` and `codex-credential-do.ts` (037 owns them); the legacy composer; a model picker (038); any new dependency; restyling the dropdown or the notice.

## Git workflow

Branch `advisor/040-codex-connect-dialog` or the one given. Conventional commits (`feat(web): add codex connect dialog`). Do not push.

## Steps

### Step 1: Keep the sign-in start in the hook

Change `useCodexConnection` so that a successful `connect` stores the `DeviceAuthStart` body in hook state (`deviceAuth: DeviceAuthStart | null`). Expose it with `clearDeviceAuth()`. While `deviceAuth` is set, the status query polls with `refetchInterval: 3000`; otherwise it does not poll. Keep the existing error toast for failures, but leave the `codex_device_auth_unavailable` and `codex_hosted_auth_unverified` codes to the dialog's "Unavailable" state: expose the last error code instead of toasting those two.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: The dialog

Create `CodexConnectDialog({ open, onOpenChange, codex })`, where `codex` is the hook's return value. Render the states from the table, derived only from `codex.deviceAuth`, `codex.status`, the last error code and a 1-second countdown timer that runs only while open. On `connected`: toast "Codex connected.", call `clearDeviceAuth()`, and close. Follow `new-project-dialog.tsx` for structure and class names.

**Verify**: `pnpm check` → exit 0.

### Step 3: Wire both entry points

In `nav-user.tsx` and the composer notice, the Connect action opens the dialog and calls `runAction("connect")`. Each place owns one `open` state. Disconnect stays as it is.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Tests

`codex-connect-dialog.test.tsx`, modeled on `new-project-dialog.test.tsx`, with fake timers and a stubbed hook value:
1. waiting: shows the code, the link has `href` `https://auth.openai.com/codex/device` and `target="_blank"`, and the countdown reads `15:00`, then `14:59` after one second;
2. countdown reaching 0 → "This code expired." and [Get a new code] calls `runAction("connect")`;
3. status `connected` → `onOpenChange(false)` and the toast is called;
4. status `reconnect_required` while a device auth is set → "Sign-in didn't complete.";
5. last error `codex_device_auth_unavailable` → the unavailable copy, and no code is shown.

**Verify**: `pnpm --filter @ditto/web test -- src/components/codex-connect-dialog.test.tsx` → 5 passed. `pnpm --filter @ditto/web test` → all pass. `pnpm check` → exit 0.

## Done criteria

- [ ] The new test file passes with at least 5 tests. The web suite, `pnpm typecheck` and `pnpm check` exit 0.
- [ ] `grep -n "CodexConnectDialog" apps/web/src/components/nav-user.tsx apps/web/src/components/composer.tsx` → one usage in each
- [ ] `grep -rn "access\|refresh" apps/web/src/components/codex-connect-dialog.tsx` → no token fields referenced
- [ ] Only in-scope files changed; `plans/README.md` 040 row updated

## STOP conditions

- 037 is not DONE, or its `DeviceAuthStart` or `pending` status differs from "Current state".
- The dialog needs a server change.
- Copy or layout seems wrong for a state not in the table. Ask; do not invent copy.

## Maintenance notes

- Browser QA is not part of this plan. A reviewer or the maintainer should open the dialog once on `pnpm dev` with 037's mocks or a real code.
- If 038 adds a model picker, it should open this same dialog for "Connect Codex" rather than adding a second flow.
