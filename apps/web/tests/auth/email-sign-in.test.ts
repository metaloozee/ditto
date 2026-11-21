import { setTimeout as sleep } from "node:timers/promises";

import type { BrowserContext } from "playwright";
import { expect, it } from "vite-plus/test";

import {
	enterCode,
	failNextEmail,
	inbox,
	latestCode,
	newAddress,
	requestSignIn,
	requestSignUpCode,
	signUpByEmail,
} from "./email.ts";
import { continueWithGoogle, googleUser } from "./google.ts";
import { CODE_EXPIRES_IN, CODE_RESEND_IN } from "./setup.ts";
import { appUrl, continueWithGitHub, gitHubUser, newVisitor } from "./visitor.ts";

const names = { firstName: "Ada", lastName: "Lovelace" };
const send = (context: BrowserContext, email: string) =>
	context.request.post("/api/auth/email-otp/send-verification-otp", {
		headers: { origin: appUrl },
		data: { email, type: "sign-in" },
	});
const verify = (context: BrowserContext, email: string, otp: string) =>
	context.request.post("/api/auth/sign-in/email-otp", {
		headers: { origin: appUrl },
		data: { email, otp },
	});
const session = async (context: BrowserContext) =>
	(await context.request.get("/api/auth/get-session")).json() as Promise<{
		user: { id: string; email: string };
	} | null>;

it("acknowledges an unknown address without sending a sign-in code or creating an account", async () => {
	const email = newAddress();
	const { context, page } = await newVisitor();
	const sent = await send(context, email);
	expect(sent.status()).toBe(200);
	await expect(inbox(email)).resolves.toEqual([]);
	expect((await verify(context, email, "000000")).ok()).toBe(false);
	await expect(session(context)).resolves.toBeNull();
	await signUpByEmail(page, { ...names, email });
});

it("signs an email-enabled user into the original account in a fresh browser", async () => {
	const email = newAddress();
	const owner = await newVisitor();
	await signUpByEmail(owner.page, { ...names, email });
	const registered = await session(owner.context);
	expect(registered).toBeTruthy();

	const visitor = await newVisitor();
	await requestSignIn(visitor.page, email);
	await expect.poll(() => inbox(email)).toHaveLength(2);
	const code = await latestCode(email);
	await enterCode(visitor.page, code);
	await visitor.page.getByRole("heading", { name: "Welcome back, Ada Lovelace" }).waitFor();
	await expect(session(visitor.context)).resolves.toMatchObject({
		user: { id: registered?.user.id, email },
	});

	const replay = await newVisitor();
	expect((await verify(replay.context, email, code)).ok()).toBe(false);
	await expect(session(replay.context)).resolves.toBeNull();
});

it.each(["GitHub", "Google"] as const)(
	"keeps email sign-in private and disabled after %s registration",
	async (provider) => {
		const email = newAddress();
		const owner = await newVisitor();
		if (provider === "GitHub") {
			await continueWithGitHub(
				owner.page,
				gitHubUser({ email, emails: [{ email, primary: true, verified: true }] }),
			);
		} else {
			await continueWithGoogle(owner.page, googleUser({ email }));
		}
		await owner.page.getByRole("heading", { name: /^Welcome back/ }).waitFor();
		const visitor = await newVisitor();
		await requestSignIn(visitor.page, email);
		await expect(inbox(email)).resolves.toEqual([]);
		const unknown = newAddress();
		const unknownVisitor = await newVisitor();
		await requestSignIn(unknownVisitor.page, unknown);
		const instructions = await visitor.page
			.getByText(email, { exact: true })
			.locator("..")
			.innerText();
		const otherInstructions = await unknownVisitor.page
			.getByText(unknown, { exact: true })
			.locator("..")
			.innerText();
		expect(instructions.replace(email, "<email>")).toBe(
			otherInstructions.replace(unknown, "<email>"),
		);
		const attempt = await verify(visitor.context, email, "123456");
		const unknownAttempt = await verify(unknownVisitor.context, unknown, "123456");
		expect(attempt.ok()).toBe(false);
		expect(attempt.status()).toBe(unknownAttempt.status());
		expect(await attempt.json()).toEqual(await unknownAttempt.json());
		await expect(session(visitor.context)).resolves.toBeNull();
		await expect(inbox(unknown)).resolves.toEqual([]);
	},
);

it("acknowledges enabled and ineligible addresses alike, including a repeated request", async () => {
	const email = newAddress();
	const owner = await newVisitor();
	await signUpByEmail(owner.page, { ...names, email });
	const enabled = await newVisitor();
	const other = await newVisitor();
	const unknown = newAddress();
	for (let i = 0; i < 2; i++) {
		const [accepted, ignored] = await Promise.all([
			send(enabled.context, email),
			send(other.context, unknown),
		]);
		expect(accepted.status()).toBe(ignored.status());
		expect(await accepted.json()).toEqual(await ignored.json());
	}
	await expect.poll(() => inbox(email)).toHaveLength(2);
	await expect(inbox(unknown)).resolves.toEqual([]);

	await sleep((CODE_RESEND_IN + 1) * 1000);
	const original = await latestCode(email);
	expect((await send(enabled.context, email)).ok()).toBe(true);
	await expect.poll(() => inbox(email)).toHaveLength(3);
	const replacement = await latestCode(email);
	if (replacement !== original)
		expect((await verify(enabled.context, email, original)).ok()).toBe(false);
	expect((await verify(enabled.context, email, replacement)).ok()).toBe(true);
	const another = await newVisitor();
	expect((await verify(another.context, email, original)).ok()).toBe(false);
	await expect(session(another.context)).resolves.toBeNull();
});

it("keeps a sign-up code from opening a session through stock sign-in", async () => {
	const email = newAddress();
	const owner = await newVisitor();
	await signUpByEmail(owner.page, { ...names, email });
	const visitor = await newVisitor();
	await requestSignUpCode(visitor.page, { ...names, email });
	const attempt = await verify(visitor.context, email, await latestCode(email));
	expect(attempt.ok()).toBe(false);
	await expect(session(visitor.context)).resolves.toBeNull();
});

it("allows a fresh delivery after Resend fails and keeps the public response neutral", async () => {
	const email = newAddress();
	const owner = await newVisitor();
	await signUpByEmail(owner.page, { ...names, email });
	const visitor = await newVisitor();
	await failNextEmail();
	const failed = await send(visitor.context, email);
	const unknown = await send((await newVisitor()).context, newAddress());
	expect(failed.status()).toBe(unknown.status());
	expect(await failed.json()).toEqual(await unknown.json());
	expect(await inbox(email)).toHaveLength(1);

	await sleep((CODE_RESEND_IN + 1) * 1000);
	expect((await send(visitor.context, email)).ok()).toBe(true);
	await expect.poll(() => inbox(email)).toHaveLength(2);
	expect((await verify(visitor.context, email, await latestCode(email))).ok()).toBe(true);
});

it("rejects an expired sign-in code", async () => {
	const email = newAddress();
	const owner = await newVisitor();
	await signUpByEmail(owner.page, { ...names, email });
	const visitor = await newVisitor();
	expect((await send(visitor.context, email)).ok()).toBe(true);
	await expect.poll(() => inbox(email)).toHaveLength(2);
	const code = await latestCode(email);
	await sleep((CODE_EXPIRES_IN + 1) * 1000);
	const expired = await verify(visitor.context, email, code);
	const unknown = await verify((await newVisitor()).context, newAddress(), code);
	expect(expired.status()).toBe(400);
	expect(expired.status()).toBe(unknown.status());
	expect(await expired.json()).toEqual(await unknown.json());
	await expect(session(visitor.context)).resolves.toBeNull();
});

it("locks the challenge after three incorrect codes across independent browsers", async () => {
	const email = newAddress();
	const owner = await newVisitor();
	await signUpByEmail(owner.page, { ...names, email });
	const visitor = await newVisitor();
	expect((await send(visitor.context, email)).ok()).toBe(true);
	await expect.poll(() => inbox(email)).toHaveLength(2);
	const code = await latestCode(email);
	const incorrect = code === "000000" ? "111111" : "000000";
	for (let attempt = 0; attempt < 3; attempt++) {
		expect((await verify(visitor.context, email, incorrect)).ok()).toBe(false);
	}
	const another = await newVisitor();
	const locked = await verify(another.context, email, code);
	const unknown = await verify((await newVisitor()).context, newAddress(), code);
	expect(locked.status()).toBe(400);
	expect(locked.status()).toBe(unknown.status());
	expect(await locked.json()).toEqual(await unknown.json());
	await expect(session(another.context)).resolves.toBeNull();
});

it("rejects cross-origin sign-in code requests before they use the resend window", async () => {
	const email = newAddress();
	const owner = await newVisitor();
	await signUpByEmail(owner.page, { ...names, email });
	const visitor = await newVisitor();
	const foreign = await visitor.context.request.post("/api/auth/email-otp/send-verification-otp", {
		headers: { origin: "https://untrusted.example" },
		data: { email, type: "sign-in" },
	});
	expect(foreign.status()).toBe(403);
	expect((await send(visitor.context, email)).ok()).toBe(true);
	await expect.poll(() => inbox(email)).toHaveLength(2);
});
