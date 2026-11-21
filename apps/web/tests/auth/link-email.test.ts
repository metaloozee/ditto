import { setTimeout as sleep } from "node:timers/promises";

import type { BrowserContext, Page } from "playwright";
import { expect, it } from "vite-plus/test";

import { enterCode, inbox, latestCode, newAddress, requestSignIn } from "./email.ts";
import { CODE_EXPIRES_IN } from "./setup.ts";
import { appUrl, continueWithGitHub, gitHubUser, newVisitor, open } from "./visitor.ts";

async function accountId(context: BrowserContext) {
	const response = await context.request.get("/api/auth/get-session");
	const { user } = (await response.json()) as { user: { id: string } };
	return user.id;
}

function submitLinkCode(context: BrowserContext, code: string) {
	return context.request.post("/api/auth/email-code/link-email/verify", {
		headers: { origin: appUrl },
		data: { code },
	});
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
	const linkingCode = await latestCode(email);
	await enterCode(original.page, linkingCode);
	await original.page.getByText("Email is linked").waitFor();
	await open(original.page, "/settings");
	await emailMethod(original.page).waitFor();

	await enterCode(visitor.page, linkingCode);
	await visitor.page.getByText("That code didn’t work. Check it or request a new one.").waitFor();
	const session = await visitor.context.request.get("/api/auth/get-session");
	expect(await session.json()).toBeNull();

	await requestSignIn(visitor.page, email);
	await expect.poll(() => inbox(email)).toHaveLength(2);
	const signInCode = await latestCode(email);
	const wrongPurpose = await submitLinkCode(original.context, signInCode);
	expect(wrongPurpose.status()).toBe(400);
	expect(await wrongPurpose.json()).toMatchObject({ code: "CODE_EXPIRED" });
	await enterCode(visitor.page, signInCode);
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
	const { context, page } = await newVisitor();
	await continueWithGitHub(page, identity);
	await startLink(page);
	const cancelledCode = await latestCode(email);
	await page.getByRole("button", { name: "Back to Settings" }).click();
	const cancelled = await submitLinkCode(context, cancelledCode);
	expect(cancelled.status()).toBe(400);
	expect(await cancelled.json()).toMatchObject({ code: "CODE_EXPIRED" });
	await open(page, "/settings");
	await page.getByRole("button", { name: "Link Email" }).waitFor();
	await startLink(page);
	await expect(inbox(email)).resolves.toHaveLength(2);
});

it("keeps email disabled when the linking code expires during an active session", async () => {
	const identity = gitHubUser();
	const { context, page } = await newVisitor();
	await continueWithGitHub(page, identity);
	await startLink(page);
	const code = await latestCode(identity.emails[0].email);
	const expires = Date.now() + CODE_EXPIRES_IN * 1000;
	while (Date.now() < expires) {
		await sleep(1000);
		await accountId(context);
	}
	await enterCode(page, code);
	await page.getByText("This code has expired. Send a new one to continue.").waitFor();
	await open(page, "/settings");
	await page.getByRole("button", { name: "Link Email" }).waitFor();
});

it("requires the session that started linking even when the user signs in again", async () => {
	const identity = gitHubUser();
	const original = await newVisitor();
	await continueWithGitHub(original.page, identity);
	await startLink(original.page);
	const code = await latestCode(identity.emails[0].email);
	const returning = await newVisitor();
	await continueWithGitHub(returning.page, identity);
	const interrupted = await submitLinkCode(returning.context, code);
	expect(interrupted.status()).toBe(400);
	expect(await interrupted.json()).toMatchObject({ code: "CODE_EXPIRED" });
	await open(returning.page, "/settings");
	await returning.page.getByRole("button", { name: "Link Email" }).waitFor();
});
