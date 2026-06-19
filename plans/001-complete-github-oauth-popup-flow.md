# Plan 001: Complete the GitHub OAuth popup flow

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c1853db..HEAD -- src/components/new-project-dialog.tsx src/routes`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `c1853db`, 2026-06-19

## Why this matters

The current GitHub repository import path opens OAuth in a popup and then waits until the popup is closed. Better Auth's GitHub callback currently renders the app inside that popup, but no code closes the popup or signals the original dialog that OAuth finished. Users can complete GitHub authorization and still remain stuck on "loading" in the original dialog until they manually close the popup.

Ditto's product direction says importing a GitHub repository is a core workflow (`PRODUCT.md:11`) and that users should understand repo/environment state (`PRODUCT.md:31`) with clear loading/error states (`PRODUCT.md:39`). This plan makes the OAuth popup lifecycle explicit and machine-verifiable.

## Current state

Relevant files:

- `src/components/new-project-dialog.tsx` — client dialog for creating a project, including GitHub import and repo list fetching.
- `src/routes/api/auth/$.ts` — Better Auth API route handler for `/api/auth/*`; do not change this unless Better Auth requires it.
- `src/routes` — TanStack Start file routes; new route files here become generated routes.

Current OAuth code in `src/components/new-project-dialog.tsx`:

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

```tsx
// src/components/new-project-dialog.tsx:156-180
const authWindow = window.open("about:blank", "github-repository-access");

try {
	const linkResult = (await authClient.linkSocial({
		provider: "github",
		scopes: ["repo"],
		disableRedirect: true,
	})) as LinkSocialResult;
	// ...
	authWindow.location.href = linkResult.data.url;
	await waitForWindowClose(authWindow);
```

Existing route convention:

```ts
// src/routes/api/auth/$.ts:1-10
import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "#/lib/auth";

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => createAuth(env).handler(request),
			POST: ({ request }) => createAuth(env).handler(request),
		},
	},
});
```

Repo conventions to match:

- TypeScript is strict (`tsconfig.json` has `strict`, `noUnusedLocals`, and `noUnusedParameters`).
- Use `#/` imports for app-local modules, as seen in `src/components/new-project-dialog.tsx:18-48`.
- Biome uses tabs and double quotes (`biome.json`).
- Existing commit messages are short, lower-case, conventional-ish: `ui: color variables`, `fix: kebab-case`.

Product constraints to honor:

- `PRODUCT.md:11`: users import a GitHub repository as part of the normal build workflow.
- `PRODUCT.md:31`: users should understand which repo/environment they are working with.
- `PRODUCT.md:39`: clear disabled/loading/error states matter for accessibility.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no TypeScript errors |
| Lint | `pnpm lint` | exit 0 or only the known pre-existing `src/components/ui/sidebar.tsx` cookie warnings |
| Full check | `pnpm check` | may fail on pre-existing UI import-order issues; must not introduce new errors in files touched by this plan |
| Tests | `pnpm test -- --runInBand` | exit 0; if Vitest rejects `--runInBand`, run `pnpm test` instead |

## Scope

**In scope** (the only source files you should modify):

- `src/components/new-project-dialog.tsx`
- `src/routes/auth/github-link-complete.tsx` (create)
- `src/components/new-project-dialog.test.tsx` (create, if practical in this repo's Vitest setup)

**Out of scope** (do NOT touch):

- `src/lib/auth.ts` — provider configuration is already present; scope is requested at link time.
- `src/routes/api/auth/$.ts` — Better Auth callback handling already works; this plan adds a post-callback page, not a new auth handler.
- Any sandbox clone/import implementation after repository selection.
- Global UI components under `src/components/ui/*`; they have pre-existing check issues and are not part of this bug.

## Git workflow

- Branch: `advisor/001-github-oauth-popup-flow`.
- Commit message: `fix: complete github popup auth flow`.
- Do not push or open a PR unless the operator instructs you.

## Steps

### Step 1: Add a popup completion route

Create `src/routes/auth/github-link-complete.tsx` with a small TanStack route that closes itself after Better Auth redirects back to it. It must also notify the opener for browsers that allow `postMessage`.

Target shape:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/auth/github-link-complete")({
	component: GitHubLinkComplete,
});

function GitHubLinkComplete() {
	useEffect(() => {
		window.opener?.postMessage({ type: "github-link-complete" }, window.location.origin);
		window.close();
	}, []);

	return (
		<main className="flex min-h-dvh items-center justify-center bg-background px-6 text-sm text-muted-foreground">
			GitHub authorization complete. You can close this window.
		</main>
	);
}
```

Keep the message type exact: `github-link-complete`. It will be used by the opener.

**Verify**: `pnpm exec tsc --noEmit` → exit 0. If route generation updates generated route files automatically during typecheck/build, include those generated files only if the repo normally tracks them.

### Step 2: Set the Better Auth callback URL for linking

In `src/components/new-project-dialog.tsx`, update the `authClient.linkSocial` call to include the callback route:

```ts
const linkResult = (await authClient.linkSocial({
	provider: "github",
	scopes: ["repo"],
	disableRedirect: true,
	callbackURL: "/auth/github-link-complete",
})) as LinkSocialResult;
```

Do not remove `disableRedirect: true`; that is what prevents the main app window from reloading.

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 3: Replace close-only waiting with message-or-close waiting

In `src/components/new-project-dialog.tsx`, replace `waitForWindowClose` with a helper that resolves when either:

1. the popup posts `{ type: "github-link-complete" }` from the same origin, or
2. the popup closes.

Target shape:

```ts
function waitForGithubLinkComplete(authWindow: Window): Promise<void> {
	return new Promise((resolve) => {
		let intervalId: number | undefined;

		const finish = () => {
			if (intervalId !== undefined) {
				window.clearInterval(intervalId);
			}
			window.removeEventListener("message", handleMessage);
			resolve();
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
	});
}
```

Then update the call site:

```ts
authWindow.location.href = linkResult.data.url;
await waitForGithubLinkComplete(authWindow);
```

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 4: Add a regression test if the existing Vitest/browser setup supports it

Create `src/components/new-project-dialog.test.tsx`. Test the pure helper if it remains top-level and exportable is acceptable; otherwise test through component behavior with mocks.

Preferred low-risk test: export only the wait helper for tests using an internal name, or place it in a small local module if Plan 003 has already been executed. If exporting from the component feels too public, skip this step and record why in `plans/README.md` status notes; do not contort the component for testability in this plan.

Minimum behavior to test:

- `waitForGithubLinkComplete` resolves when it receives a same-origin `github-link-complete` message.
- It ignores messages from a different origin.
- It removes the `message` event listener after resolving.

Example Vitest shape if extracting to an export is acceptable:

```ts
import { describe, expect, it, vi } from "vitest";
import { waitForGithubLinkComplete } from "#/components/new-project-dialog";

describe("waitForGithubLinkComplete", () => {
	it("resolves when the popup posts the completion message", async () => {
		vi.useFakeTimers();
		const popup = { closed: false } as Window;
		const promise = waitForGithubLinkComplete(popup);

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: window.location.origin,
				data: { type: "github-link-complete" },
			}),
		);

		await expect(promise).resolves.toBeUndefined();
		vi.useRealTimers();
	});
});
```

**Verify**: `pnpm test -- src/components/new-project-dialog.test.tsx` → exit 0. If no test is added, run `pnpm test` → exit 0 and document the reason in the plan index.

### Step 5: Run final checks

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
```

Expected:

- Typecheck exits 0.
- Lint exits 0 or only reports the known pre-existing `src/components/ui/sidebar.tsx` cookie warnings.
- Tests exit 0.

## Test plan

- Prefer a new unit test around the popup completion waiter.
- If component-level testing is added instead, mock `authClient.linkSocial`, `authClient.getAccessToken`, `window.open`, and `fetch`; assert that selecting GitHub opens a popup and eventually calls GitHub repos after the completion message.
- Existing test coverage is currently absent (`find src -name '*.test.*'` returned no source tests during planning), so keep the first test narrow and deterministic.

## Done criteria

- [ ] `src/routes/auth/github-link-complete.tsx` exists and posts `{ type: "github-link-complete" }` to `window.opener` before attempting `window.close()`.
- [ ] `src/components/new-project-dialog.tsx` passes `callbackURL: "/auth/github-link-complete"` to `authClient.linkSocial` while preserving `disableRedirect: true`.
- [ ] The dialog no longer waits only for `authWindow.closed`; it also handles the completion message.
- [ ] `pnpm exec tsc --noEmit` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] No files outside the in-scope list (plus generated route files if the repo tracks them) are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- Better Auth rejects `callbackURL` on `linkSocial` in this installed version.
- The TanStack route path syntax for `/auth/github-link-complete` differs from the target shape and cannot be confirmed from nearby route files.
- Route generation requires manual edits to generated files that conflict with repository conventions.
- Testing the helper requires broad component rewrites; leave tests for Plan 003 instead.
- The OAuth fix appears to require changing provider secrets, environment variables, or `src/lib/auth.ts`.

## Maintenance notes

Reviewers should manually test the full browser flow: open the new project dialog, choose GitHub, authorize in the popup, confirm the popup closes and the original dialog lists repositories without reloading the main app. If later GitHub import uses a dedicated backend endpoint, keep this popup completion route until all OAuth flows move to the new endpoint.
