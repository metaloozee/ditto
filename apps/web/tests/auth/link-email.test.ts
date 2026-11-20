import type { BrowserContext, Page } from "playwright";
import { expect, it } from "vite-plus/test";

import { enterCode, latestCode, newAddress } from "./email.ts";
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

	await startLink(original.page);
	await original.page.getByText(email, { exact: true }).waitFor();
	await enterCode(original.page, await latestCode(email));
	await original.page.getByText("Email is linked").waitFor();
	await open(original.page, "/settings");
	await emailMethod(original.page).waitFor();

	const returning = await newVisitor();
	await continueWithGitHub(returning.page, identity);
	expect(await accountId(returning.context)).toBe(originalId);
	await open(returning.page, "/settings");
	await emailMethod(returning.page).waitFor();
});
