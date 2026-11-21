import { randomInt } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import {
	enterCode,
	failNextEmail,
	inbox,
	latestCode,
	newAddress,
	requestSignUpCode,
	signUpByEmail,
	submitSignUpForm,
} from "./email.ts";
import { continueWithGoogle, googleUser } from "./google.ts";
import { CODE_EXPIRES_IN, CODE_RESEND_IN } from "./setup.ts";
import { appUrl, continueWithGitHub, gitHubUser, newVisitor, open } from "./visitor.ts";

const heading = (page: Page) => page.getByRole("heading", { level: 1 }).innerText();
const path = (page: Page) => new URL(page.url()).pathname;
const shows = (page: Page, text: string) => page.getByText(text).first().waitFor();

/** Whether Settings lists `method` as enabled for the signed-in visitor. */
async function methodEnabled(page: Page, method: string) {
	await open(page, "/settings");
	return page
		.getByText(method, { exact: true })
		.locator("xpath=../..")
		.getByText("Enabled")
		.isVisible();
}

/** Calls the sign-up API directly, from one client address per `ip`. */
const api = (ip: string) => (route: "send" | "verify", body: Record<string, string>) =>
	fetch(`${appUrl}/api/auth/email-code/sign-up/${route}`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: appUrl, "cf-connecting-ip": ip },
		body: JSON.stringify(body),
	});
const newIp = () => `10.7.${randomInt(256)}.${randomInt(256)}`;
const names = { firstName: "Ada", lastName: "Lovelace" };
const hasSession = (response: Response) =>
	response.headers
		.getSetCookie()
		.some((c) => c.includes("session_token=") && !/Max-Age=0/i.test(c));

describe("registration", () => {
	it("registers with names and an emailed code, then greets by full name", async () => {
		const { page } = await newVisitor();
		const email = newAddress();

		await signUpByEmail(page, { firstName: "Ada", lastName: "Lovelace", email });

		await expect(heading(page)).resolves.toBe("Welcome back, Ada Lovelace");
		await expect(methodEnabled(page, "Email")).resolves.toBe(true);
	});

	it("emails the code and its expiry from Ditto, and never returns the code", async () => {
		const { page } = await newVisitor();
		const email = newAddress();
		const bodies: Promise<string>[] = [];
		page.on("response", (r) => {
			if (r.url().includes("/api/auth/")) bodies.push(r.text().catch(() => ""));
		});

		await signUpByEmail(page, { firstName: "Ada", lastName: "Lovelace", email });

		const [sent] = await inbox(email);
		expect(sent?.from).toBe("Ditto <sign-in@test.example>");
		expect(sent?.text).toMatch(/Your Ditto code is \d{6}\./);
		expect(sent?.text).toContain(`expires in ${CODE_EXPIRES_IN} seconds`);
		const code = await latestCode(email);
		for (const body of await Promise.all(bodies)) expect(body).not.toContain(code);
	});

	it("lets the visitor correct the address, leaving the first one free", async () => {
		const { page } = await newVisitor();
		const typo = newAddress();
		const fixed = newAddress();
		await requestSignUpCode(page, { ...names, email: typo });
		await page.getByRole("button", { name: "Use a different email" }).click();

		await page.getByLabel("Email address").fill(fixed);
		await page.getByRole("button", { name: "Continue with email" }).click();
		await shows(page, fixed);
		await enterCode(page, await latestCode(fixed));
		await page.getByRole("heading", { name: /^Welcome back/ }).waitFor();

		const other = await newVisitor();
		await signUpByEmail(other.page, { firstName: "Typo", lastName: "Owner", email: typo });
		await expect(heading(other.page)).resolves.toBe("Welcome back, Typo Owner");
	});

	it("keeps the saved names and sends an existing email user to sign in", async () => {
		const email = newAddress();
		const first = await newVisitor();
		await signUpByEmail(first.page, { firstName: "Ada", lastName: "Lovelace", email });

		const again = await newVisitor();
		await requestSignUpCode(again.page, { firstName: "Someone", lastName: "Else", email });
		await enterCode(again.page, await latestCode(email));

		await shows(again.page, "You already have a Ditto account");
		expect(path(again.page)).toBe("/sign-in");
		await open(again.page, "/");
		expect(path(again.page)).toBe("/sign-in");
		await first.page.reload({ waitUntil: "networkidle" });
		await expect(heading(first.page)).resolves.toBe("Welcome back, Ada Lovelace");
	});

	it.each(["GitHub", "Google"] as const)(
		"keeps email disabled when a %s user repeats registration",
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

			const { context, page } = await newVisitor();
			await requestSignUpCode(page, { ...names, email });
			const code = await latestCode(email);
			const signIn = await context.request.post("/api/auth/sign-in/email-otp", {
				headers: { origin: appUrl },
				data: { email, otp: code },
			});
			expect(signIn.status()).toBe(400);
			await expect((await context.request.get("/api/auth/get-session")).json()).resolves.toBeNull();

			await enterCode(page, code);
			await shows(page, "This account uses another sign-in method");
			await open(page, "/");
			expect(path(page)).toBe("/sign-in");
			await expect(methodEnabled(owner.page, "Email")).resolves.toBe(false);
			const request = await context.request.post("/api/auth/email-otp/send-verification-otp", {
				headers: { origin: appUrl },
				data: { email, type: "sign-in" },
			});
			expect(request.ok()).toBe(true);
			expect(await inbox(email)).toHaveLength(1);
		},
	);
	it("checks names against the server's limits before sending a code", async () => {
		const { page } = await newVisitor();
		const email = newAddress();

		await submitSignUpForm(page, { firstName: "A".repeat(101), lastName: "   ", email });

		await shows(page, "Use 100 characters or fewer.");
		await shows(page, "Enter your last name.");
		expect(path(page)).toBe("/sign-up");
		await expect(inbox(email)).resolves.toEqual([]);
	});

	it("refuses an address Better Auth could never send a sign-in code to", async () => {
		const { page } = await newVisitor();
		const email = newAddress().replace("+", "!");

		await submitSignUpForm(page, { ...names, email });

		await shows(page, "Enter an email address like name@example.com.");
		const response = await api(newIp())("send", { email });
		expect(response.status).toBe(400);
		expect(((await response.json()) as { code?: string }).code).toBe("INVALID_EMAIL");
		await expect(inbox(email)).resolves.toEqual([]);
	});
});

describe("codes", () => {
	it("counts down three wrong codes, then needs a new one", async () => {
		const { page } = await newVisitor();
		const email = newAddress();
		await requestSignUpCode(page, { ...names, email });
		const code = await latestCode(email);
		const wrong = code === "000000" ? "111111" : "000000";

		await enterCode(page, wrong);
		await shows(page, "That code isn’t right. 2 tries left.");
		await enterCode(page, wrong);
		await shows(page, "That code isn’t right. 1 try left.");
		await enterCode(page, wrong);
		await shows(page, "Too many incorrect codes. Send a new one to continue.");

		const response = await api(newIp())("verify", { ...names, email, code });
		expect(response.status).toBe(400);
		expect(hasSession(response)).toBe(false);
	});

	it("rejects an expired code", async () => {
		const { page } = await newVisitor();
		const email = newAddress();
		await requestSignUpCode(page, { ...names, email });
		const code = await latestCode(email);

		await sleep((CODE_EXPIRES_IN + 1) * 1000);
		await enterCode(page, code);

		await shows(page, "This code has expired. Send a new one to continue.");
	}, 30_000);

	it("replaces the code on resend, after the server's wait", async () => {
		const { page } = await newVisitor();
		const email = newAddress();
		await requestSignUpCode(page, { ...names, email });
		const old = await latestCode(email);
		await shows(page, "Send another in");

		await page.getByRole("button", { name: "Send a new code" }).click({
			timeout: (CODE_RESEND_IN + 2) * 1000,
		});
		await shows(page, "New code sent");
		const fresh = await latestCode(email);

		await enterCode(page, old);
		await shows(page, "That code isn’t right. 2 tries left.");
		await enterCode(page, fresh);
		await page.getByRole("heading", { name: /^Welcome back/ }).waitFor();
	});

	it("pauses code entry while a new code is sent, then starts from an empty row", async () => {
		const { page } = await newVisitor();
		const email = newAddress();
		await requestSignUpCode(page, { ...names, email });
		const code = page.getByLabel("Code");
		await code.fill("12");

		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		await page.route(
			"**/api/auth/email-code/sign-up/send",
			async (route) => {
				await held;
				await route.continue();
			},
			{ times: 1 },
		);
		await page.getByRole("button", { name: "Send a new code" }).click({
			timeout: (CODE_RESEND_IN + 2) * 1000,
		});

		await expect.poll(() => code.isDisabled()).toBe(true);
		release();
		await shows(page, "New code sent");
		await expect.poll(() => code.isDisabled()).toBe(false);
		await expect(code.inputValue()).resolves.toBe("");
		await expect.poll(() => code.evaluate((input) => input === document.activeElement)).toBe(true);

		await enterCode(page, await latestCode(email));
		await page.getByRole("heading", { name: /^Welcome back/ }).waitFor();
	});

	it("rejects verification from an untrusted origin", async () => {
		const email = newAddress();
		const ip = newIp();
		const call = api(ip);
		await call("send", { email });
		const code = await latestCode(email);

		const rejected = await fetch(`${appUrl}/api/auth/email-code/sign-up/verify`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "https://other.example",
				"cf-connecting-ip": ip,
			},
			body: JSON.stringify({ ...names, email, code }),
		});

		expect(rejected.status).toBe(403);
		expect(hasSession(rejected)).toBe(false);
		expect((await call("verify", { ...names, email, code })).status).toBe(200);
	});

	it("opens one session for a code, however often it is submitted", async () => {
		const email = newAddress();
		const call = api(newIp());
		await call("send", { email });
		const code = await latestCode(email);

		const [a, b] = await Promise.all([
			call("verify", { ...names, email, code }),
			call("verify", { ...names, email, code }),
		]);
		const replay = await call("verify", { ...names, email, code });

		expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 400]);
		expect([a, b].filter(hasSession)).toHaveLength(1);
		expect(replay.status).toBe(400);
		expect(hasSession(replay)).toBe(false);
	});

	it("never creates an account without the code", async () => {
		const email = newAddress();
		const call = api(newIp());
		await call("send", { email });

		await call("verify", { ...names, email, code: "12345" });

		const { page } = await newVisitor();
		await signUpByEmail(page, { firstName: "Real", lastName: "Owner", email });
		await expect(heading(page)).resolves.toBe("Welcome back, Real Owner");
	});
});

describe("delivery and limits", () => {
	it("stays on the form when the email can't be sent, and retries", async () => {
		const { page } = await newVisitor();
		const email = newAddress();
		await failNextEmail();

		await submitSignUpForm(page, { ...names, email });
		await shows(page, "We couldn’t send your code");
		expect(await page.getByLabel("Email address").inputValue()).toBe(email);

		await page.getByRole("button", { name: "Continue with email" }).click();
		await page.getByRole("heading", { name: "Check your email" }).waitFor();
		await enterCode(page, await latestCode(email));
		await page.getByRole("heading", { name: /^Welcome back/ }).waitFor();
	});

	it("makes a second code to the same address wait, from any client", async () => {
		const email = newAddress();
		await api(newIp())("send", { email });

		const response = await api(newIp())("send", { email });

		expect(response.status).toBe(429);
		expect(Number(response.headers.get("x-retry-after"))).toBeGreaterThan(0);
		expect(await inbox(email)).toHaveLength(1);
	});

	it("keeps the resend wait even after three wrong codes", async () => {
		const email = newAddress();
		const call = api(newIp());
		await call("send", { email });
		const wrong = (await latestCode(email)) === "000000" ? "111111" : "000000";
		for (let i = 0; i < 3; i++) await call("verify", { ...names, email, code: wrong });

		const response = await api(newIp())("send", { email });

		expect(response.status).toBe(429);
		expect(await inbox(email)).toHaveLength(1);
	});

	it("sends only one code when different clients request it concurrently", async () => {
		const email = newAddress();

		const responses = await Promise.all(
			Array.from({ length: 5 }, () => api(newIp())("send", { email })),
		);

		expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([
			200, 429, 429, 429, 429,
		]);
		expect(await inbox(email)).toHaveLength(1);
	});

	it("throttles one client asking for many codes", async () => {
		const call = api(newIp());
		const statuses: number[] = [];
		for (let i = 0; i < 6; i++) statuses.push((await call("send", { email: newAddress() })).status);

		expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
		expect(statuses[5]).toBe(429);
	});

	it("throttles one client guessing codes", async () => {
		const call = api(newIp());
		const statuses: number[] = [];
		for (let i = 0; i < 11; i++)
			statuses.push(
				(await call("verify", { ...names, email: newAddress(), code: "000000" })).status,
			);

		expect(statuses.at(-1)).toBe(429);
	});
});
