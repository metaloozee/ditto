import { randomInt } from "node:crypto";

import { expect, it } from "vite-plus/test";

import { appUrl, continueWithGitHub, gitHubUser, newVisitor, open } from "./visitor.ts";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
	fetch(`${appUrl}/api/auth${path}`, {
		method: "POST",
		redirect: "manual",
		headers: {
			"content-type": "application/json",
			origin: appUrl,
			"cf-connecting-ip": `10.9.${randomInt(256)}.${randomInt(256)}`,
			...headers,
		},
		body: JSON.stringify(body),
	});

it("starts GitHub sign-in for Ditto's own return paths", async () => {
	const response = await post("/sign-in/social", { provider: "github", callbackURL: "/" });
	expect(response.status).toBe(200);
});

it("rejects an untrusted return destination", async () => {
	const response = await post("/sign-in/social", {
		provider: "github",
		callbackURL: "https://evil.example/",
	});
	expect(response.status).toBe(403);
});

it("ignores a sign-out sent from another site", async () => {
	const { context, page } = await newVisitor();
	await continueWithGitHub(page, gitHubUser());
	const cookie = (await context.cookies(appUrl)).map((c) => `${c.name}=${c.value}`).join("; ");

	const response = await post("/sign-out", {}, { cookie, origin: "https://evil.example" });

	expect(response.status).toBe(403);
	await open(page, "/");
	expect(new URL(page.url()).pathname).toBe("/");
});

it("rejects a GitHub callback whose state Ditto didn't issue", async () => {
	const response = await fetch(`${appUrl}/api/auth/callback/github?code=forged&state=forged`, {
		redirect: "manual",
	});
	expect(response.status).toBe(302);
	expect(new URL(response.headers.get("location") ?? "", appUrl).searchParams.get("error")).toMatch(
		/state/,
	);
	expect(
		response.headers
			.getSetCookie()
			.some((c) => c.includes("session_token=") && !/Max-Age=0/i.test(c)),
	).toBe(false);
});

it.each(["/sign-up/email", "/sign-in/email"])("refuses password auth at %s", async (path) => {
	const response = await post(path, {
		email: "a@example.com",
		password: "hunter22hunter22",
		name: "A",
	});
	expect(response.ok).toBe(false);
	expect(response.headers.getSetCookie()).toEqual([]);
});

it("keeps method removal unavailable", async () => {
	const response = await post("/unlink-account", { providerId: "github" });
	expect(response.status).toBe(404);
});
