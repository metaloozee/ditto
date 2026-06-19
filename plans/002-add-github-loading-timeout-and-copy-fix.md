# Plan 002: Add GitHub loading timeout and fix broken loading copy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c1853db..HEAD -- src/components/new-project-dialog.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-complete-github-oauth-popup-flow.md
- **Category**: bug
- **Planned at**: commit `c1853db`, 2026-06-19

## Why this matters

The GitHub import dialog can remain in a loading state forever if the popup is abandoned, blocked, or fails to complete. The same loading state currently displays a replacement character (`�`), which makes a core onboarding flow look broken. This plan makes failure recoverable and restores calm, precise UI copy consistent with the product's design principles.

Product constraints from `PRODUCT.md`: importing GitHub repositories is part of the primary workflow (`PRODUCT.md:11`), the UI should have purposeful empty/loading/error states (`PRODUCT.md:34`, `PRODUCT.md:39`), and users should not feel trapped in opaque flows (`PRODUCT.md:17`).

## Current state

Relevant file:

- `src/components/new-project-dialog.tsx` — owns GitHub repo loading state and the dialog UI.

Current wait helper has no timeout:

```tsx
// src/components/new-project-dialog.tsx:100-108
function waitForWindowClose(authWindow: Window): Promise<void> {
	return new Promise((resolve) => {
		const intervalId = window.setInterval(() => {
			if (authWindow.closed) {
				window.clearInterval(intervalId);
				resolve();
			}
		}, 500);
	});
}
```

Current load call awaits the helper before token fetch:

```tsx
// src/components/new-project-dialog.tsx:179-184
authWindow.location.href = linkResult.data.url;
await waitForWindowClose(authWindow);

const tokenResult = (await authClient.getAccessToken({
	providerId: "github",
})) as AccessTokenResult;
```

Current loading copy contains a replacement character:

```tsx
// src/components/new-project-dialog.tsx:363-365
{githubLoading ? (
	<CommandEmpty>Loading repositories�</CommandEmpty>
) : githubError ? (
```

Repo conventions to match:

- TypeScript strict mode is enabled.
- Use simple `Error` objects for user-facing failures in this component, as already done at `src/components/new-project-dialog.tsx:165-197`.
- Biome formatting uses tabs and double quotes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no TypeScript errors |
| Lint | `pnpm lint` | exit 0 or only known pre-existing `src/components/ui/sidebar.tsx` cookie warnings |
| Tests | `pnpm test` | exit 0 |
| Full check | `pnpm check` | may fail on pre-existing UI import-order issues; must not introduce errors in `src/components/new-project-dialog.tsx` |

## Scope

**In scope** (the only files you should modify):

- `src/components/new-project-dialog.tsx`
- `src/components/new-project-dialog.test.tsx` (create only if adding focused tests is practical)

**Out of scope**:

- OAuth route/callback mechanics beyond using the completion helper from Plan 001.
- Extracting the GitHub API client into a separate module; that is Plan 003.
- Global UI components under `src/components/ui/*`.

## Git workflow

- Branch: `advisor/002-github-loading-timeout-copy`.
- Commit message: `fix: handle github auth timeout`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Replace the broken loading glyph

In `src/components/new-project-dialog.tsx`, replace the broken loading text with an ASCII ellipsis or the correct Unicode ellipsis. Prefer ASCII to avoid another encoding issue:

```tsx
<CommandEmpty>Loading repositories...</CommandEmpty>
```

**Verify**: `rg "Loading repositories" src/components/new-project-dialog.tsx` → output contains `Loading repositories...` and no `�`.

### Step 2: Add a timeout constant

Near the other top-level constants in `src/components/new-project-dialog.tsx`, add:

```ts
const GITHUB_AUTH_TIMEOUT_MS = 2 * 60 * 1000;
```

Two minutes is long enough for a normal OAuth approval and short enough to recover from an abandoned popup.

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 3: Add timeout behavior to the popup waiter

If Plan 001 has landed, update `waitForGithubLinkComplete`. If Plan 001 has not landed, update the current `waitForWindowClose`; however this plan depends on Plan 001 and should normally use the message-aware helper.

Target behavior:

- Resolve normally on completion message or window close.
- Reject after `GITHUB_AUTH_TIMEOUT_MS` with message `GitHub authorization timed out. Please try again.`
- Clear both interval and timeout in every finish path.
- Remove the message event listener in every finish path if Plan 001 added one.

Target shape for the message-aware helper:

```ts
function waitForGithubLinkComplete(authWindow: Window): Promise<void> {
	return new Promise((resolve, reject) => {
		let intervalId: number | undefined;
		let timeoutId: number | undefined;

		const cleanup = () => {
			if (intervalId !== undefined) window.clearInterval(intervalId);
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
			window.removeEventListener("message", handleMessage);
		};

		const finish = () => {
			cleanup();
			resolve();
		};

		const fail = () => {
			cleanup();
			reject(new Error("GitHub authorization timed out. Please try again."));
		};

		const handleMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;
			if (event.data?.type !== "github-link-complete") return;
			finish();
		};

		window.addEventListener("message", handleMessage);
		intervalId = window.setInterval(() => {
			if (authWindow.closed) finish();
		}, 500);
		timeoutId = window.setTimeout(fail, GITHUB_AUTH_TIMEOUT_MS);
	});
}
```

If TypeScript reports `Timer` type issues, keep the IDs typed as `number | undefined`; this project includes DOM libs and uses browser `window.setTimeout` / `window.setInterval`.

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 4: Ensure timeout closes the popup and surfaces a retryable error

The existing catch block closes `authWindow` and sets `githubError`:

```tsx
// src/components/new-project-dialog.tsx:217-224
} catch (error) {
	authWindow?.close();
	setGithubError(
		error instanceof Error
			? error.message
			: "Unable to load GitHub repositories.",
	);
	setGithubRepos([]);
}
```

Keep that behavior. After Step 3, the timeout rejection should flow through this block and display `GitHub authorization timed out. Please try again.` in the command empty state.

If there is no explicit retry button, do not add one in this plan; the user can click Back and choose GitHub again. A dedicated retry button can be a future UI enhancement.

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 5: Add focused tests if the helper is testable

If Plan 001 exposed or extracted the popup waiter, add tests covering:

- timeout rejects with `GitHub authorization timed out. Please try again.`
- timeout clears interval/timeout after completion
- completion before timeout resolves and does not reject

Example Vitest pattern:

```ts
import { describe, expect, it, vi } from "vitest";
import { waitForGithubLinkComplete } from "#/components/new-project-dialog";

describe("waitForGithubLinkComplete", () => {
	it("rejects after the GitHub auth timeout", async () => {
		vi.useFakeTimers();
		const popup = { closed: false } as Window;
		const promise = waitForGithubLinkComplete(popup);

		await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

		await expect(promise).rejects.toThrow(
			"GitHub authorization timed out. Please try again.",
		);
		vi.useRealTimers();
	});
});
```

If the helper is not exported and Plan 003 has not extracted it yet, skip direct tests and document this in `plans/README.md`. Do not make a broad testability refactor in this small fix.

**Verify**: If test added, `pnpm test -- src/components/new-project-dialog.test.tsx` → exit 0. Otherwise, `pnpm test` → exit 0.

### Step 6: Run final checks

Run:

```bash
rg "�" src/components/new-project-dialog.tsx
pnpm exec tsc --noEmit
pnpm lint
pnpm test
```

Expected:

- `rg "�" ...` prints no matches and exits 1 because no replacement character remains.
- Typecheck exits 0.
- Lint exits 0 or only known pre-existing sidebar cookie warnings.
- Tests exit 0.

## Test plan

- Best case: unit test the popup waiter with fake timers.
- Required manual test: start GitHub import, leave the popup unfinished, and confirm the main dialog stops loading after two minutes with the timeout error. If manual two-minute testing is too slow, temporarily lower the constant locally during manual verification, then restore it before final checks.
- Confirm loading copy displays `Loading repositories...` with no replacement glyph.

## Done criteria

- [ ] No `�` character remains in `src/components/new-project-dialog.tsx`.
- [ ] GitHub auth waiting rejects after `GITHUB_AUTH_TIMEOUT_MS`.
- [ ] Timeout rejection displays a user-facing error through existing `githubError` state.
- [ ] Timer/listener cleanup occurs on success and timeout.
- [ ] `pnpm exec tsc --noEmit` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 has not landed and the helper shape is still close-only; this plan should be applied after the popup completion flow is fixed.
- TypeScript timer types cannot be resolved without changing `tsconfig.json` or global types.
- Adding tests requires changing shared test infrastructure or installing dependencies.
- The fix appears to require modifying global UI components.

## Maintenance notes

The timeout constant is UX-sensitive. If support reports slow OAuth approvals, adjust `GITHUB_AUTH_TIMEOUT_MS` in one place and update corresponding fake-timer tests. Reviewers should scrutinize cleanup paths to avoid leaked intervals/listeners.
