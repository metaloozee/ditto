import { randomInt } from "node:crypto";

import {
	chromium,
	type Browser,
	type BrowserContext,
	type BrowserContextOptions,
	type Page,
} from "playwright";
import { afterAll, beforeAll, inject, onTestFinished } from "vite-plus/test";

import type { GitHubAuthorization, GitHubIdentity } from "./fake-upstream.ts";

export const appUrl = inject("appUrl");

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
});

/**
 * A fresh browser — its own cookies and client address, like a separate
 * device — with one page open. Distinct addresses keep tests from sharing
 * rate limits.
 */
export async function newVisitor(options: BrowserContextOptions = {}) {
	const context = await browser.newContext({
		baseURL: appUrl,
		...options,
		extraHTTPHeaders: {
			"cf-connecting-ip": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`,
		},
	});
	onTestFinished(() => context.close());
	const page = await context.newPage();
	return { context, page };
}

/**
 * A test-stage session lapses after a few idle seconds, so the auth tests can watch it expire.
 * For tests requiring an active owner, refresh until the test closes the browser context.
 */
export function keepSignedIn(context: BrowserContext) {
	const refresh = setInterval(() => {
		context.request.get("/api/auth/get-session").catch(() => {});
	}, 2000);
	refresh.unref();
	context.on("close", () => clearInterval(refresh));
}

/**
 * Presses Sign out: from the account menu in the workspace sidebar, or the button on pages
 * that show one, such as Settings.
 */
export async function clickSignOut(page: Page) {
	const account = page.getByRole("button", { name: "Account" });
	if (await account.isVisible()) {
		await account.click();
		await page.getByRole("menuitem", { name: "Sign out" }).click();
	} else {
		await page.getByRole("button", { name: "Sign out" }).click();
	}
}

/** Opens `path` and waits until the page is hydrated and its buttons work. */
export async function open(page: Page, path: string) {
	await page.goto(path, { waitUntil: "networkidle" });
}

let nextId = 1000 + randomInt(1_000_000);

/** A GitHub identity no other test uses, with a verified public email. */
export function gitHubUser(overrides: Partial<GitHubIdentity> = {}): GitHubIdentity {
	const id = nextId++;
	const email = `octo${id}@example.com`;
	return {
		id,
		login: `octo${id}`,
		name: `Octo Cat ${id}`,
		email,
		emails: [{ email, primary: true, verified: true }],
		...overrides,
	};
}

/**
 * Continues with GitHub from `from`, as `authorization` on the consent
 * screen, and waits until Ditto has handled the callback.
 */
export async function continueWithGitHub(
	page: Page,
	authorization: GitHubAuthorization,
	from: "/sign-in" | "/sign-up" = "/sign-in",
) {
	await nextGitHubAuthorization(authorization);
	await open(page, from);
	// The redirects through GitHub and back end in one new page load.
	const landed = page.waitForEvent("load");
	await page.getByRole("button", { name: "Continue with GitHub" }).click();
	await landed;
	await page.waitForLoadState("networkidle");
}

/** Sets what the simulated GitHub consent screen does next. */
export async function nextGitHubAuthorization(authorization: GitHubAuthorization) {
	const response = await fetch(`${inject("upstreamUrl")}/__github/next`, {
		method: "POST",
		body: JSON.stringify(authorization),
	});
	if (!response.ok) throw new Error(`Queuing a GitHub authorization failed: ${response.status}`);
}
