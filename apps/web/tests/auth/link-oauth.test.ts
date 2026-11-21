import { setTimeout as sleep } from "node:timers/promises";

import type { Page } from "playwright";
import { expect, it } from "vite-plus/test";

import type { GoogleAuthorization } from "./fake-upstream.ts";
import { continueWithGoogle, googleUser, nextGoogleAuthorization } from "./google.ts";
import { SESSION_EXPIRES_IN } from "./setup.ts";
import {
	appUrl,
	continueWithGitHub,
	gitHubUser,
	newVisitor,
	nextGitHubAuthorization,
	open,
} from "./visitor.ts";

it("links Google in Settings and opens the same profile through either provider", async () => {
	const github = gitHubUser();
	const google = googleUser({ email: github.email ?? undefined });
	const { page } = await newVisitor();
	await continueWithGitHub(page, github);
	await open(page, "/settings");

	await nextGoogleAuthorization(google);
	await page.getByRole("button", { name: "Link Google" }).click();
	await page.getByText("Google is linked", { exact: true }).waitFor({ timeout: 10_000 });
	await open(page, "/settings");
	await expect.poll(() => page.getByText("Enabled", { exact: true }).count()).toBe(2);
	await expect.poll(() => page.getByRole("button", { name: "Link Google" }).count()).toBe(0);

	const googleVisitor = await newVisitor();
	await continueWithGoogle(googleVisitor.page, google);
	await expect
		.poll(() => googleVisitor.page.locator("h1").textContent())
		.toBe(`Welcome back, ${github.name}`);

	const githubVisitor = await newVisitor();
	await continueWithGitHub(githubVisitor.page, github);
	await expect
		.poll(() => githubVisitor.page.locator("h1").textContent())
		.toBe(`Welcome back, ${github.name}`);
});

async function pauseGoogleLink(page: Page, email: string) {
	let pause!: (resume: () => Promise<void>) => void;
	const paused = new Promise<() => Promise<void>>((resolve) => {
		pause = resolve;
	});
	await page.route(
		"**/accounts.google.com/o/oauth2/v2/auth?**",
		async (route) => {
			const response = await route.fetch({ maxRedirects: 0 });
			pause(() => route.fulfill({ response }));
		},
		{ times: 1 },
	);
	await nextGoogleAuthorization(googleUser({ email }));
	await page.getByRole("button", { name: "Link Google" }).click();
	return paused;
}

it("leaves Google disabled when the browser returns in a different session for the same account", async () => {
	const github = gitHubUser();
	const first = await newVisitor();
	const second = await newVisitor();
	await continueWithGitHub(first.page, github);
	await continueWithGitHub(second.page, github);
	await open(first.page, "/settings");

	const callback = await pauseGoogleLink(first.page, github.email ?? "");
	const replacement = (await second.context.cookies(appUrl)).filter((cookie) =>
		cookie.name.endsWith(".session_token"),
	);
	expect(replacement).toHaveLength(1);
	await first.context.addCookies(replacement);
	await callback();

	await first.page.getByText("Google wasn’t linked", { exact: true }).waitFor({ timeout: 10_000 });
	await open(first.page, "/settings");
	await expect
		.poll(() => first.page.getByRole("button", { name: "Link Google" }).isVisible())
		.toBe(true);
});

it("links GitHub from a Google account and keeps the original Google profile", async () => {
	const google = googleUser();
	const github = gitHubUser({
		email: null,
		emails: [{ email: google.email, primary: true, verified: true }],
	});
	const { page } = await newVisitor();
	await continueWithGoogle(page, google);
	await open(page, "/settings");

	await nextGitHubAuthorization(github);
	await page.getByRole("button", { name: "Link GitHub" }).click();
	await page.getByText("GitHub is linked", { exact: true }).waitFor({ timeout: 10_000 });
	await open(page, "/settings");
	await expect.poll(() => page.getByText("Enabled", { exact: true }).count()).toBe(2);
	await expect.poll(() => page.getByRole("button", { name: "Link GitHub" }).count()).toBe(0);

	const returned = await newVisitor();
	await continueWithGitHub(returned.page, github);
	await expect
		.poll(() => returned.page.locator("h1").textContent())
		.toBe(`Welcome back, ${google.name}`);
});

const rejectedLinks: {
	name: string;
	authorization: (email: string) => GoogleAuthorization;
	message: string;
}[] = [
	{
		name: "consent is cancelled",
		authorization: () => ({ cancel: true }),
		message: "You cancelled before it finished. Nothing changed.",
	},
	{
		name: "the verified email is different",
		authorization: () => googleUser(),
		message: "That Google account uses a different email",
	},
	{
		name: "the same email is unverified",
		authorization: (email) => googleUser({ email, email_verified: false }),
		message: "That Google account uses a different email",
	},
];

it.each(rejectedLinks)(
	"preserves original access when $name",
	async ({ authorization, message }) => {
		const github = gitHubUser();
		const { page } = await newVisitor();
		await continueWithGitHub(page, github);
		await open(page, "/settings");

		await nextGoogleAuthorization(authorization(github.email ?? ""));
		await page.getByRole("button", { name: "Link Google" }).click();
		await page.getByText(message, { exact: true }).waitFor({ timeout: 10_000 });
		await assertOriginalMethod(page, github.name);
	},
);

it("keeps a Google identity already linked elsewhere with its original Ditto account", async () => {
	const google = googleUser();
	const owner = await newVisitor();
	await continueWithGoogle(owner.page, google);

	const github = gitHubUser();
	const { page } = await newVisitor();
	await continueWithGitHub(page, github);
	await open(page, "/settings");
	const changedGoogleEmail = { ...google, email: github.email ?? "" };
	await nextGoogleAuthorization(changedGoogleEmail);
	await page.getByRole("button", { name: "Link Google" }).click();
	await expect
		.poll(() =>
			page
				.getByText("That Google account belongs to another Ditto account", { exact: true })
				.isVisible(),
		)
		.toBe(true);
	await assertOriginalMethod(page, github.name);

	const returned = await newVisitor();
	await continueWithGoogle(returned.page, changedGoogleEmail);
	await expect
		.poll(() => returned.page.locator("h1").textContent())
		.toBe(`Welcome back, ${google.name}`);
});

it.each(["sign-out", "expiry"])(
	"leaves Google disabled after session %s before callback",
	async (interruption) => {
		const github = gitHubUser();
		const { context, page } = await newVisitor();
		await continueWithGitHub(page, github);
		await open(page, "/settings");
		const callback = await pauseGoogleLink(page, github.email ?? "");

		if (interruption === "sign-out") {
			const secondTab = await context.newPage();
			await open(secondTab, "/settings");
			await secondTab.getByRole("button", { name: "Sign out" }).click();
			await secondTab.waitForURL((url) => url.pathname === "/sign-in");
		} else {
			await sleep((SESSION_EXPIRES_IN + 1) * 1000);
		}
		await callback();
		await page.waitForURL((url) => url.pathname === "/sign-in");
		await continueWithGitHub(page, github);
		await assertOriginalMethod(page, github.name);
	},
);

async function assertOriginalMethod(page: Page, displayName: string | null) {
	await open(page, "/settings");
	await page.getByText(displayName ?? "", { exact: true }).waitFor({ timeout: 10_000 });
	await expect.poll(() => page.getByText("Enabled", { exact: true }).count()).toBe(1);
	await expect.poll(() => page.getByRole("button", { name: "Link Google" }).isVisible()).toBe(true);
}
