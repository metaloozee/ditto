import type { BrowserContext, Page } from "playwright";
import { expect, it } from "vite-plus/test";

import { enterCode, inbox, latestCode, newAddress, requestSignIn } from "./email.ts";
import { continueWithGitHub, gitHubUser, newVisitor, open } from "./visitor.ts";

async function accountId(context: BrowserContext) {
	const response = await context.request.get("/api/auth/get-session");
	const { user } = (await response.json()) as { user: { id: string } };
	return user.id;
}

const emailMethod = (page: Page) =>
	page.getByText("Email", { exact: true }).locator("xpath=../..").getByText("Enabled");

async function startLink(page: Page) {
	await open(page, "/settings");
	await page.getByRole("button", { name: "Link Email" }).click();
	await page.getByRole("heading", { name: "Add email sign-in" }).waitFor();
}

it("enables email on the existing account after mailbox verification", async () => {
	const email = newAddress();
	const identity = gitHubUser({ email, emails: [{ email, primary: true, verified: true }] });
	const original = await newVisitor();
	await continueWithGitHub(original.page, identity);
	const originalId = await accountId(original.context);

	const visitor = await newVisitor();
	await requestSignIn(visitor.page, email);
	await expect(inbox(email)).resolves.toEqual([]);
	await startLink(original.page);
	await original.page.getByText(email, { exact: true }).waitFor();
	await enterCode(original.page, await latestCode(email));
	await original.page.getByText("Email is linked").waitFor();
	await open(original.page, "/settings");
	await emailMethod(original.page).waitFor();

	await requestSignIn(visitor.page, email);
	await expect.poll(() => inbox(email)).toHaveLength(2);
	await enterCode(visitor.page, await latestCode(email));
	await visitor.page.getByRole("heading", { name: /^Welcome back/ }).waitFor();
	expect(await accountId(visitor.context)).toBe(originalId);

	const returning = await newVisitor();
	await continueWithGitHub(returning.page, identity);
	expect(await accountId(returning.context)).toBe(originalId);
	await open(returning.page, "/settings");
	await emailMethod(returning.page).waitFor();
});

it("leaves email disabled after cancelling and sends a fresh code when linking restarts", async () => {
	const email = newAddress();
	const identity = gitHubUser({ email, emails: [{ email, primary: true, verified: true }] });
	const { page } = await newVisitor();
	await continueWithGitHub(page, identity);
	await startLink(page);
	const cancelledCode = await latestCode(email);
	await page.getByRole("button", { name: "Back to Settings" }).click();
	await page.getByRole("button", { name: "Link Email" }).waitFor();
	await startLink(page);
	await expect(inbox(email)).resolves.toHaveLength(2);
	await expect(latestCode(email)).resolves.not.toBe(cancelledCode);
});
