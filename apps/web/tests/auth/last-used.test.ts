import type { BrowserContext, Page } from "playwright";
import { expect, it } from "vite-plus/test";

import { enterCode, latestCode, newAddress, requestSignIn, signUpByEmail } from "./email.ts";
import { continueWithGoogle, googleUser, nextGoogleAuthorization } from "./google.ts";
import { continueWithGitHub, gitHubUser, newVisitor, open } from "./visitor.ts";

async function signOut(page: Page) {
	await page.getByRole("button", { name: "Sign out" }).click();
	await page.waitForURL((url) => url.pathname === "/sign-in");
}

/** The sign-in buttons marked "Last used", once hydrated and in the server's HTML. */
async function marked(context: BrowserContext, page: Page) {
	await open(page, "/sign-in");
	const hydrated = await page.getByRole("button").filter({ hasText: "Last used" }).allInnerTexts();
	const html = await (await context.request.get("/sign-in")).text();
	const served = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/gs)]
		.map(([, inner]) => inner?.replace(/<[^>]+>/g, " ") ?? "")
		.filter((text) => text.includes("Last used"));
	const label = (text: string) => text.replace("Last used", "").replace(/\s+/g, " ").trim();
	return { hydrated: hydrated.map(label), served: served.map(label) };
}

const only = (label: string) => ({ hydrated: [label], served: [label] });

it("marks nothing for a browser that has never signed in", async () => {
	const { context, page } = await newVisitor();

	await expect(marked(context, page)).resolves.toEqual({ hydrated: [], served: [] });
});

it("marks GitHub after a GitHub sign-up and sign-out", async () => {
	const { context, page } = await newVisitor();
	await continueWithGitHub(page, gitHubUser(), "/sign-up");
	await signOut(page);

	await expect(marked(context, page)).resolves.toEqual(only("Continue with GitHub"));
});

it("moves the mark to the method used most recently", async () => {
	const { context, page } = await newVisitor();
	await continueWithGitHub(page, gitHubUser());
	await signOut(page);
	await continueWithGoogle(page, googleUser());
	await signOut(page);

	await expect(marked(context, page)).resolves.toEqual(only("Continue with Google"));
});

it("marks email after an email sign-up, and after an email sign-in", async () => {
	const email = newAddress();
	const first = await newVisitor();
	await signUpByEmail(first.page, { firstName: "Ada", lastName: "Lovelace", email });
	await signOut(first.page);
	await expect(marked(first.context, first.page)).resolves.toEqual(only("Continue with email"));

	const second = await newVisitor();
	await requestSignIn(second.page, email);
	await enterCode(second.page, await latestCode(email));
	await second.page.getByRole("heading", { name: /^Welcome back/ }).waitFor();
	await signOut(second.page);
	await expect(marked(second.context, second.page)).resolves.toEqual(only("Continue with email"));
});

it("keeps the mark on the sign-in method when Settings links another", async () => {
	const github = gitHubUser();
	const { context, page } = await newVisitor();
	await continueWithGitHub(page, github);
	await open(page, "/settings");
	await nextGoogleAuthorization(googleUser({ email: github.email ?? undefined }));
	await page.getByRole("button", { name: "Link Google" }).click();
	await page.getByText("Google is linked", { exact: true }).waitFor({ timeout: 10_000 });
	await open(page, "/settings");
	await signOut(page);

	await expect(marked(context, page)).resolves.toEqual(only("Continue with GitHub"));
});

it("never marks a button on sign-up", async () => {
	const { page } = await newVisitor();
	await continueWithGitHub(page, gitHubUser());
	await signOut(page);
	await open(page, "/sign-up");

	await expect(page.getByText("Last used").count()).resolves.toBe(0);
});
