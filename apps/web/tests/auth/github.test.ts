import type { Page } from "playwright";
import { expect, it } from "vite-plus/test";

import { continueWithGitHub, gitHubUser, newVisitor, open } from "./visitor.ts";

const heading = (page: Page) => page.getByRole("heading", { level: 1 }).innerText();

/** The Settings profile and sign-in methods, as a signed-in visitor sees them. */
async function settings(page: Page) {
	await open(page, "/settings");
	const value = (term: string) =>
		page.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd").innerText();
	return {
		displayName: await value("Display name"),
		email: await value("Email"),
		gitHubEnabled: await page
			.getByText("GitHub", { exact: true })
			.locator("xpath=../..")
			.getByText("Enabled")
			.isVisible(),
	};
}

it("registers a new GitHub user and greets them by display name", async () => {
	const { page } = await newVisitor();

	await continueWithGitHub(page, gitHubUser({ name: "Grace Hopper" }), "/sign-up");

	expect(new URL(page.url()).pathname).toBe("/");
	await expect(heading(page)).resolves.toBe("Welcome back, Grace Hopper");
});

it("shows the profile and GitHub as the enabled method in Settings", async () => {
	const user = gitHubUser({ name: "Ada Lovelace" });
	const { page } = await newVisitor();

	await continueWithGitHub(page, user);

	await expect(settings(page)).resolves.toEqual({
		displayName: "Ada Lovelace",
		email: user.email,
		gitHubEnabled: true,
	});
});

it("falls back to the GitHub login when there is no display name", async () => {
	const user = gitHubUser({ name: null });
	const { page } = await newVisitor();

	await continueWithGitHub(page, user);

	await expect(heading(page)).resolves.toBe(`Welcome back, ${user.login}`);
});

it("accepts a verified private primary address", async () => {
	const base = gitHubUser();
	const hidden = `hidden${base.id}@example.com`;
	const user = {
		...base,
		email: null,
		emails: [
			{ email: `old${base.id}@example.com`, primary: false, verified: true },
			{ email: hidden, primary: true, verified: true },
		],
	};
	const { page } = await newVisitor();

	await continueWithGitHub(page, user);

	await expect(settings(page).then((s) => s.email)).resolves.toBe(hidden);
});

it("returns to the same account by GitHub ID after the upstream email changes", async () => {
	const user = gitHubUser({ name: "Linus" });
	const first = await newVisitor();
	await continueWithGitHub(first.page, user);

	const moved = `moved${user.id}@example.com`;
	const again = await newVisitor();
	await continueWithGitHub(again.page, {
		...user,
		name: "Linus Renamed",
		email: moved,
		emails: [{ email: moved, primary: true, verified: true }],
	});

	await expect(settings(again.page)).resolves.toEqual({
		displayName: "Linus",
		email: user.email,
		gitHubEnabled: true,
	});
});

it("recognizes a linked GitHub identity when its email is no longer available", async () => {
	const user = gitHubUser({ name: "Grace Hopper" });
	const first = await newVisitor();
	await continueWithGitHub(first.page, user);

	const next = await newVisitor();
	await continueWithGitHub(next.page, { ...user, email: null, emails: [] });
	await expect(settings(next.page)).resolves.toMatchObject({
		displayName: "Grace Hopper",
		email: user.email,
	});
});

it("refuses to register an unverified GitHub address", async () => {
	const base = gitHubUser();
	const user = { ...base, emails: [{ email: base.email ?? "", primary: true, verified: false }] };
	const { page } = await newVisitor();

	await continueWithGitHub(page, user, "/sign-up");
	await page.getByText("GitHub sign-in failed").waitFor({ timeout: 3000 });
	await open(page, "/");

	expect(new URL(page.url()).pathname).toBe("/sign-in");
});

it("returns to sign-in with a message when consent is cancelled", async () => {
	const { page } = await newVisitor();

	await continueWithGitHub(page, { cancel: true }, "/sign-up");

	expect(new URL(page.url()).pathname).toBe("/sign-in");
	await expect(page.getByText("GitHub sign-in was cancelled").isVisible()).resolves.toBe(true);
});

it("offers another sign-in method when GitHub sign-in cannot start", async () => {
	const { page } = await newVisitor();
	await open(page, "/sign-up");
	await page.route("**/api/auth/sign-in/social", (route) =>
		route.fulfill({ status: 503, json: {} }),
	);

	await page.getByRole("button", { name: "Continue with GitHub" }).click();

	await page.getByText("GitHub sign-in failed").waitFor({ timeout: 3000 });
	await expect(page.getByRole("button", { name: "Continue with email" }).isEnabled()).resolves.toBe(
		true,
	);
});
