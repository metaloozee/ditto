import { describe, expect, it } from "vite-plus/test";

import { redact } from "./redact.ts";
import { evidenceEntry, type Observation } from "./takeover/entry.ts";
import { grade } from "./takeover/grade.ts";
import { assertClean, redactUrl } from "./takeover/redact.ts";

describe("evidence entry", () => {
	const observation: Observation = {
		workflow: "LinkedIn",
		task: "open the feed",
		at: new Date("2026-11-23T09:15:00Z"),
		tookOver: true,
		steppedThrough: false,
		botSignedIn: true,
		afterHandBack: "https://www.linkedin.com/checkpoint/challenge/AgH3x9?x=1",
		finishedAt: "https://www.linkedin.com/feed/",
		challenges: "device check by email code",
		siteResponse: "accepted the code and signed in",
		denied: ["sparrow.cloudflare.com", "content-autofill.googleapis.com"],
	};

	it("records the grade, the challenge and the bot reaching the page after hand-back", () => {
		const entry = evidenceEntry(observation);

		expect(entry).toMatch(
			/^#### 2026-11-23 · LinkedIn login with take-over · works with take-over$/m,
		);
		expect(entry).toContain("device check by email code");
		expect(entry).toContain("accepted the code and signed in");
		expect(entry).toContain("https://www.linkedin.com/checkpoint/challenge/<path>");
		expect(entry).toMatch(/bot reached the signed-in page after hand-back: yes/i);
		expect(entry).not.toMatch(/finish/i);
		expect(entry).toContain("`sparrow.cloudflare.com`");
	});

	it("records a run on Cloudflare Containers with its own route and network origin", () => {
		const entry = evidenceEntry({ ...observation, host: "cloudflare" });

		expect(entry).toMatch(/^#### 2026-11-23 · LinkedIn login with take-over on Cloudflare · /m);
		expect(entry).toContain("- **Network origin:** Cloudflare container");
		expect(entry).toContain("Cloudflare Containers");
		expect(entry).not.toContain("- **Network origin:** container\n");
	});

	it("refuses a run with no take-over: the profile was already signed in, so nothing was tested", () => {
		expect(() => evidenceEntry({ ...observation, tookOver: false })).toThrow(/already signed in/);
	});

	it("refuses to render a note that leaks an account identifier", () => {
		expect(() =>
			evidenceEntry({ ...observation, siteResponse: "signed in as owner@example.com" }),
		).toThrow(/email/);
	});
});
import { TakeOver } from "./takeover/session.ts";

describe("evidence redaction", () => {
	it("drops query strings and fragments, which carry tokens and account hints", () => {
		expect(
			redactUrl("https://accounts.google.com/signin/challenge/pwd?TL=abc123&continue=x#identifier"),
		).toBe("https://accounts.google.com/signin/challenge/pwd");
	});

	it("hides profile handles and any segment that is not a plain word", () => {
		expect(redactUrl("https://www.linkedin.com/in/jane-doe-1b2c3d/")).toBe(
			"https://www.linkedin.com/in/<path>",
		);
		expect(redactUrl("https://www.linkedin.com/in/janedoe")).toBe(
			"https://www.linkedin.com/in/<path>",
		);
		expect(redactUrl("https://myaccount.google.com/u/1/personal-info")).toBe(
			"https://myaccount.google.com/u/<path>",
		);
		expect(redactUrl("https://dash.cloudflare.com/0123456789abcdef0123456789abcdef/home")).toBe(
			"https://dash.cloudflare.com/<path>",
		);
	});

	it("names a browser page that has no web origin by its scheme", () => {
		expect(redactUrl("about:blank")).toBe("about:blank");
		expect(redactUrl("chrome://newtab/")).toBe("chrome://newtab/");
		expect(redactUrl("chrome-error://chromewebdata/")).toBe("chrome-error://chromewebdata/");
	});

	it("refuses evidence holding an email, cookie, token or long account number", () => {
		expect(() => assertClean("Signed in as owner@example.com")).toThrow(/email/);
		expect(() => assertClean("cookie: SID=abc")).toThrow(/cookie/);
		expect(() => assertClean("Set-Cookie: li_at=abc")).toThrow(/cookie/);
		expect(() => assertClean("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig")).toThrow(/token/);
		expect(() => assertClean("key 0123456789abcdef0123456789abcdef")).toThrow(/token/);
		expect(() => assertClean("account 117234567890123456789")).toThrow(/account/);
	});

	it.each([
		"Signed in as owner@example.com",
		"Set-Cookie: li_at=abc",
		"Authorization: Bearer sk-live",
		"token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
		"account 9f1c2a7e-4b3d-4c55-8e21-0a6b7c8d9e10",
		"account 117234567890123456789",
		"key 0123456789abcdef0123456789abcdef",
	])("redacts what it refuses, and refuses what it redacts: %s", (leak) => {
		expect(() => assertClean(leak)).toThrow();
		expect(() => assertClean(redact(leak, []))).not.toThrow();
	});

	it("accepts the status codes, hosts and timings a grade depends on", () => {
		expect(() =>
			assertClean(
				"2026-11-22 09:15 UTC · accounts.google.com returned 200 in 1.8s; denied www.gstatic.com",
			),
		).not.toThrow();
	});
});

describe("take-over session", () => {
	it("refuses bot actions while the owner has control", async () => {
		const session = new TakeOver();
		await session.takeOver();

		await expect(session.act(async () => "click")).rejects.toThrow(/owner has control/);
		await expect(session.inspect(async () => "screen")).rejects.toThrow(/owner has control/);
	});

	it("waits for in-flight bot work before signalling take-over is ready", async () => {
		const session = new TakeOver();
		const order: string[] = [];
		let finish = () => {};
		const work = session.act(
			() =>
				new Promise<void>((resolve) => {
					finish = () => {
						order.push("bot done");
						resolve();
					};
				}),
		);

		const ready = session.takeOver().then(() => order.push("take-over ready"));
		await Promise.resolve();
		finish();
		await Promise.all([work, ready]);

		expect(order).toEqual(["bot done", "take-over ready"]);
	});

	it("keeps the owner in control when the view disconnects", async () => {
		const session = new TakeOver();
		await session.takeOver();
		session.disconnect();

		expect(session.controller).toBe("owner");
		await expect(session.act(async () => "click")).rejects.toThrow(/owner has control/);
	});

	it("makes the bot inspect the screen before its first action after hand-back", async () => {
		const session = new TakeOver();
		await session.takeOver();
		session.handBack();

		await expect(session.act(async () => "click")).rejects.toThrow(/inspect/);
		expect(await session.inspect(async () => "screen")).toBe("screen");
		expect(await session.act(async () => "click")).toBe("click");
	});
});

describe("grade", () => {
	it("passes a workflow the bot completed with no owner help", () => {
		expect(grade({ tookOver: false, steppedThrough: false, botSignedIn: true })).toBe("pass");
	});

	it("marks a workflow works with take-over when the bot reached the page after hand-back", () => {
		expect(grade({ tookOver: true, steppedThrough: false, botSignedIn: true })).toBe(
			"works with take-over",
		);
	});

	it("fails a workflow the owner had to operate step by step", () => {
		expect(grade({ tookOver: true, steppedThrough: true, botSignedIn: true })).toBe("unsupported");
	});

	it("fails a workflow the bot could not finish after hand-back", () => {
		expect(grade({ tookOver: true, steppedThrough: false, botSignedIn: false })).toBe(
			"unsupported",
		);
	});
});
