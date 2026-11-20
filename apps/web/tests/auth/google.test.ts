import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { continueWithGoogle, googleUser } from "./google.ts";
import { appUrl, continueWithGitHub, gitHubUser, newVisitor, open } from "./visitor.ts";

const heading = (page: Page) => page.getByRole("heading", { level: 1 }).innerText();

/** The Settings profile and sign-in methods, as a signed-in visitor sees them. */
async function settings(page: Page) {
	await open(page, "/settings");
	expect(new URL(page.url()).pathname).toBe("/settings");
	const value = (term: string) =>
		page.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd").innerText();
	const enabled = (method: string) =>
		page.getByText(method, { exact: true }).locator("xpath=../..").getByText("Enabled").isVisible();
	return {
		displayName: await value("Display name"),
		email: await value("Email"),
		gitHubEnabled: await enabled("GitHub"),
		googleEnabled: await enabled("Google"),
	};
}

/** The signed-in user as Better Auth reports it over HTTP. */
async function sessionUser(context: BrowserContext) {
	const cookies = await context.cookies(appUrl);
	const response = await fetch(`${appUrl}/api/auth/get-session`, {
		headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") },
	});
	const session = (await response.json()) as { user: Record<string, unknown> } | null;
	return session?.user;
}

it("registers a new Google user and greets them by display name", async () => {
	const { page } = await newVisitor();

	await continueWithGoogle(page, googleUser({ name: "Grace Hopper" }), "/sign-up");

	expect(new URL(page.url()).pathname).toBe("/");
	await expect(heading(page)).resolves.toBe("Welcome back, Grace Hopper");
});

it("keeps Google's display name and structured names", async () => {
	const user = googleUser({ name: "Ada King", given_name: "Ada", family_name: "Lovelace" });
	const { context, page } = await newVisitor();

	await continueWithGoogle(page, user, "/sign-up");

	await expect(sessionUser(context)).resolves.toMatchObject({
		name: "Ada King",
		firstName: "Ada",
		lastName: "Lovelace",
	});
});

it("registers a Google user who shares no name", async () => {
	const { name: _, given_name: __, family_name: ___, ...user } = googleUser();
	const { context, page } = await newVisitor();

	await continueWithGoogle(page, user, "/sign-up");

	expect(new URL(page.url()).pathname).toBe("/");
	await expect(heading(page)).resolves.toBe("Welcome back");
	await expect(sessionUser(context)).resolves.toMatchObject({
		email: user.email,
		name: "",
		firstName: null,
		lastName: null,
	});
});

it("shows the profile and Google as the enabled method in Settings", async () => {
	const user = googleUser({ name: "Mary Somerville" });
	const { page } = await newVisitor();

	await continueWithGoogle(page, user);

	await expect(settings(page)).resolves.toEqual({
		displayName: "Mary Somerville",
		email: user.email,
		gitHubEnabled: false,
		googleEnabled: true,
	});
});

it.each([true, false])(
	"keeps the same account when the new Google email is verified: %s",
	async (verified) => {
		const user = googleUser({ name: "Hedy Lamarr" });
		const first = await newVisitor();
		await continueWithGoogle(first.page, user, "/sign-up");
		const original = await sessionUser(first.context);
		expect(original?.id).toEqual(expect.any(String));

		const again = await newVisitor();
		await continueWithGoogle(again.page, {
			...user,
			name: "Hedy Renamed",
			email: `moved${user.sub}@example.com`,
			email_verified: verified,
		});

		await expect(sessionUser(again.context)).resolves.toMatchObject({ id: original?.id });
		await expect(settings(again.page)).resolves.toEqual({
			displayName: "Hedy Lamarr",
			email: user.email,
			gitHubEnabled: false,
			googleEnabled: true,
		});
	},
);

it("refuses to register an unverified Google address", async () => {
	const { page } = await newVisitor();

	await continueWithGoogle(page, googleUser({ email_verified: false }), "/sign-up");
	await open(page, "/");

	expect(new URL(page.url()).pathname).toBe("/sign-in");
});

it("returns to sign-in when consent is cancelled, and lets the visitor retry", async () => {
	const { page } = await newVisitor();

	await continueWithGoogle(page, { cancel: true }, "/sign-up");

	expect(new URL(page.url()).pathname).toBe("/sign-in");
	await expect(page.getByText("Google sign-in was cancelled").isVisible()).resolves.toBe(true);

	await continueWithGoogle(page, googleUser({ name: "Second Try" }));
	await expect(heading(page)).resolves.toBe("Welcome back, Second Try");
});

describe("an address that already belongs to another account", () => {
	const wrongMethod = "This account uses another sign-in method";

	it("keeps the account private when Google has not verified the address", async () => {
		const owner = googleUser();
		const ownerVisit = await newVisitor();
		await continueWithGoogle(ownerVisit.page, owner, "/sign-up");

		const { page } = await newVisitor();
		await continueWithGoogle(page, googleUser({ email: owner.email, email_verified: false }));

		expect(new URL(page.url()).pathname).toBe("/sign-in");
		await expect(page.getByText(wrongMethod).isVisible()).resolves.toBe(false);
		await open(page, "/");
		expect(new URL(page.url()).pathname).toBe("/sign-in");
	});

	it("doesn't link Google to a GitHub account or sign the visitor in", async () => {
		const owner = gitHubUser({ name: "Octo Owner" });
		const ownerVisit = await newVisitor();
		await continueWithGitHub(ownerVisit.page, owner, "/sign-up");

		const { page } = await newVisitor();
		await continueWithGoogle(page, googleUser({ email: owner.email ?? "" }));

		expect(new URL(page.url()).pathname).toBe("/sign-in");
		await expect(page.getByText(wrongMethod).isVisible()).resolves.toBe(true);
		await open(page, "/");
		expect(new URL(page.url()).pathname).toBe("/sign-in");

		await continueWithGitHub(ownerVisit.page, owner);
		await expect(settings(ownerVisit.page)).resolves.toMatchObject({
			gitHubEnabled: true,
			googleEnabled: false,
		});
	});

	it("doesn't link GitHub to a Google account or sign the visitor in", async () => {
		const owner = googleUser();
		const ownerVisit = await newVisitor();
		await continueWithGoogle(ownerVisit.page, owner, "/sign-up");

		const { page } = await newVisitor();
		const intruder = gitHubUser({ email: owner.email });
		await continueWithGitHub(page, {
			...intruder,
			emails: [{ email: owner.email, primary: true, verified: true }],
		});

		expect(new URL(page.url()).pathname).toBe("/sign-in");
		await expect(page.getByText(wrongMethod).isVisible()).resolves.toBe(true);
		await open(page, "/");
		expect(new URL(page.url()).pathname).toBe("/sign-in");

		await continueWithGoogle(ownerVisit.page, owner);
		await expect(settings(ownerVisit.page)).resolves.toMatchObject({
			gitHubEnabled: false,
			googleEnabled: true,
		});
	});
});
