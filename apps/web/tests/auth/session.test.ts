import { setTimeout as sleep } from "node:timers/promises";

import { devices, type BrowserContext, type Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { SESSION_EXPIRES_IN } from "./setup.ts";
import { appUrl, continueWithGitHub, gitHubUser, newVisitor, open } from "./visitor.ts";

const path = (page: Page) => new URL(page.url()).pathname;

async function signOut(page: Page) {
	await page.getByRole("button", { name: "Sign out" }).click();
	await page.waitForURL((url) => url.pathname === "/sign-in");
}

/** Asks Better Auth directly whether these cookies still hold a session. */
async function sessionFor(context: BrowserContext) {
	const cookies = await context.cookies(appUrl);
	const response = await fetch(`${appUrl}/api/auth/get-session`, {
		headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") },
	});
	return (await response.json()) as unknown;
}

describe("protected pages", () => {
	it.each(["/", "/settings", "/settings/verify-email"])(
		"sends a signed-out visitor from %s to sign-in",
		async (protectedPath) => {
			const response = await fetch(`${appUrl}${protectedPath}`, { redirect: "manual" });
			expect(response.status).toBeGreaterThanOrEqual(300);
			expect(response.status).toBeLessThan(400);
			expect(new URL(response.headers.get("location") ?? "", appUrl).pathname).toBe("/sign-in");
		},
	);

	it.each(["/design", "/design/auth", "/design.md"])("serves %s without a session", async (p) => {
		const response = await fetch(`${appUrl}${p}`, { redirect: "manual" });
		expect(response.status).toBe(200);
	});
});

describe("sessions", () => {
	it("survives a refresh", async () => {
		const { page } = await newVisitor();
		await continueWithGitHub(page, gitHubUser());

		await page.reload({ waitUntil: "networkidle" });

		expect(path(page)).toBe("/");
	});

	it("keeps the account open for a retry when sign-out fails", async () => {
		const { page } = await newVisitor();
		await continueWithGitHub(page, gitHubUser());
		await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 503, json: {} }));

		await page.getByRole("button", { name: "Sign out" }).click();
		await page.getByText("Couldn’t sign out").waitFor({ timeout: 3000 });
		expect(path(page)).toBe("/");
		await page.unroute("**/api/auth/sign-out");
		await signOut(page);
	});

	it("signing out revokes the session on the server immediately", async () => {
		const { context, page } = await newVisitor();
		await continueWithGitHub(page, gitHubUser());
		const stolen = await context.cookies(appUrl);
		await expect(sessionFor(context)).resolves.not.toBeNull();

		await signOut(page);

		const replay = await newVisitor();
		await replay.context.addCookies(stolen);
		await expect(sessionFor(replay.context)).resolves.toBeNull();
		await open(replay.page, "/");
		expect(path(replay.page)).toBe("/sign-in");
	});

	it("keeps a phone and a laptop signed in independently", async () => {
		const user = gitHubUser();
		const laptop = await newVisitor();
		const phone = await newVisitor(devices["Pixel 7"]);
		await continueWithGitHub(laptop.page, user);
		await continueWithGitHub(phone.page, user);

		await signOut(laptop.page);
		await phone.page.reload({ waitUntil: "networkidle" });

		expect(path(phone.page)).toBe("/");
		await open(laptop.page, "/");
		expect(path(laptop.page)).toBe("/sign-in");
	});

	it("stays alive while used and ends after a period of inactivity", async () => {
		const { page } = await newVisitor();
		await continueWithGitHub(page, gitHubUser());

		// Active for longer than the session lifetime.
		const activeUntil = Date.now() + (SESSION_EXPIRES_IN + 2) * 1000;
		while (Date.now() < activeUntil) {
			await sleep(1000);
			await page.reload({ waitUntil: "networkidle" });
			expect(path(page)).toBe("/");
		}

		await sleep((SESSION_EXPIRES_IN + 1) * 1000);
		await page.reload({ waitUntil: "networkidle" });
		expect(path(page)).toBe("/sign-in");
	}, 60_000);
});
