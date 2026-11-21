import { randomInt } from "node:crypto";

import type { Page } from "playwright";
import { inject } from "vite-plus/test";

import type { GoogleAuthorization, GoogleIdentity } from "./fake-upstream.ts";
import { open } from "./visitor.ts";

let nextSub = 10_000_000 + randomInt(1_000_000_000);

/** A Google identity no other test uses, with a verified email and full name. */
export function googleUser(overrides: Partial<GoogleIdentity> = {}): GoogleIdentity {
	const sub = String(nextSub++);
	return {
		sub,
		email: `goog${sub}@example.com`,
		email_verified: true,
		name: `Gina Google ${sub}`,
		given_name: "Gina",
		family_name: `Google ${sub}`,
		...overrides,
	};
}

/** Sets what the simulated Google consent screen does next. */
export async function nextGoogleAuthorization(authorization: GoogleAuthorization) {
	const response = await fetch(`${inject("upstreamUrl")}/__google/next`, {
		method: "POST",
		body: JSON.stringify(authorization),
	});
	if (!response.ok) throw new Error(`Queuing a Google authorization failed: ${response.status}`);
}

/**
 * Continues with Google from `from`, as `authorization` on the consent
 * screen, and waits until Ditto has handled the callback.
 */
export async function continueWithGoogle(
	page: Page,
	authorization: GoogleAuthorization,
	from: "/sign-in" | "/sign-up" = "/sign-in",
) {
	await nextGoogleAuthorization(authorization);
	await open(page, from);
	// The redirects through Google and back end in one new page load.
	const landed = page.waitForEvent("load");
	await page.getByRole("button", { name: "Continue with Google" }).click();
	await landed;
	await page.waitForLoadState("networkidle");
}
