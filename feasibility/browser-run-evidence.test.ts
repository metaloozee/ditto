// The Browser Run trial's evidence entries (#36): grades come from what the bot observed, and no
// entry may carry a session ID, a Live View link or a cookie.
import { describe, expect, it } from "vite-plus/test";

import { forgetEntry, restoreEntry, sessionsEntry } from "./browser-run/evidence.ts";
import { refusedByGuardrails } from "./browser-run/request-log.ts";

const DAY = 24 * 60 * 60_000;
const saved = new Date("2026-11-24T09:00:00Z");

describe("restored login", () => {
	it("passes when the bot reaches the signed-in page in a new session on a later date", () => {
		const entry = restoreEntry({
			workflow: "LinkedIn",
			task: "open the LinkedIn feed and confirm it is signed in",
			at: new Date(saved.getTime() + 2 * DAY),
			savedAt: saved,
			restoredCookies: 31,
			botSignedIn: true,
			finishedAt: "https://www.linkedin.com/feed/?trk=SIMULATED",
			refused: [],
			requested: 12,
		});

		expect(entry).toMatch(
			/^#### 2026-11-26 · LinkedIn login restored from saved cookies after 2 days · pass$/m,
		);
		expect(entry).toContain("31 cookies restored");
		expect(entry).toContain("at https://www.linkedin.com/feed.");
		expect(entry).toContain("- **Fallback:** none needed");
	});

	it("fails without the owner, and leaves what else the site needed for the owner to state", () => {
		const entry = restoreEntry({
			workflow: "Google",
			task: "open Google Account home and confirm it is signed in",
			at: new Date(saved.getTime() + DAY),
			savedAt: saved,
			restoredCookies: 20,
			botSignedIn: false,
			finishedAt: "https://accounts.google.com/v3/signin/identifier?continue=SIMULATED",
			refused: ["play.google.com"],
			requested: 9,
		});

		expect(entry).toMatch(/after 1 day · fail$/m);
		expect(entry).toContain("Guardrails refused: `play.google.com`");
		expect(entry).toContain("_owner to state what else the site needed");
	});

	it("does not grade a restore on the day the cookies were saved as a later date", () => {
		const entry = restoreEntry({
			workflow: "Google",
			task: "open Google Account home",
			at: new Date(saved.getTime() + 60 * 60_000),
			savedAt: saved,
			restoredCookies: 20,
			botSignedIn: true,
			finishedAt: "https://myaccount.google.com/",
			refused: [],
			requested: 9,
		});

		expect(entry).toMatch(/ on the day they were saved · pass$/m);
	});
});

describe("deleted cookies", () => {
	it("passes only when every workflow starts signed out after the deletion", () => {
		const at = new Date("2026-11-27T10:00:00Z");
		const ended = forgetEntry({
			at,
			restoredCookies: 0,
			signedIn: { Google: false, LinkedIn: false },
		});
		const kept = forgetEntry({
			at,
			restoredCookies: 0,
			signedIn: { Google: false, LinkedIn: true },
		});

		expect(ended).toMatch(/^#### 2026-11-27 · Deleting the stored cookies ends the login · pass$/m);
		expect(kept).toMatch(/ · fail$/m);
		expect(kept).toContain("LinkedIn: still signed in");
	});
});

describe("sessions", () => {
	it("lists each session's length and close reason, and the browser-hours they add up to", () => {
		const entry = sessionsEntry({
			at: new Date("2026-11-27T10:00:00Z"),
			workspaces: [
				{
					workspace: "ws-takeover",
					sessions: [
						{
							session: 1,
							startTime: 0,
							endTime: 18 * 60_000,
							durationMs: 18 * 60_000,
							closeReason: 1,
							closeReasonText: "NormalClosure",
						},
						{
							session: 2,
							startTime: 0,
							endTime: 24 * 60_000,
							durationMs: 24 * 60_000,
							closeReasonText: "BrowserIdle",
						},
						{ session: 3, startTime: 0, open: true },
					],
				},
			],
			usedBrowserTimeSeconds: 7200,
		});

		expect(entry).toContain("`ws-takeover` session 1: 18.0 min, closed `NormalClosure` (1)");
		expect(entry).toContain("session 2: 24.0 min, closed `BrowserIdle`");
		expect(entry).toContain("session 3: still open");
		expect(entry).toContain("0.70 browser-hours across the 2 closed sessions");
		expect(entry).toContain("account total reported by `limits()`: 2.00 browser-hours");
	});

	it("says so when limits() reports no browser time", () => {
		const entry = sessionsEntry({
			at: new Date(),
			workspaces: [],
			usedBrowserTimeSeconds: undefined,
		});

		expect(entry).toContain("`limits()` reported no browser time");
	});
});

it("refuses an entry that would carry a Live View link's token", () => {
	expect(() =>
		restoreEntry({
			workflow: "Google",
			task: "open Google Account home",
			at: new Date(saved.getTime() + DAY),
			savedAt: saved,
			restoredCookies: 1,
			botSignedIn: true,
			// A Live View URL carries a JWT; redactUrl keeps only the origin and plain paths, so a
			// token can only arrive through a field rendered as is, like a refused host.
			finishedAt: "https://myaccount.google.com/",
			refused: ["eyJhbGciOi.eyJzdWIiOi.SIMULATED"],
			requested: 1,
		}),
	).toThrow(/token/);
});

describe("guardrail refusals in the request log", () => {
	it.each([
		["403 with cf-mitigated: guardrails", 403, { "cf-mitigated": "guardrails" }, true],
		["header names in any case", 403, { "CF-Mitigated": "guardrails" }, true],
		["403 from the site itself", 403, {}, false],
		["another Cloudflare mitigation", 403, { "cf-mitigated": "challenge" }, false],
		["a page that loaded", 200, { "cf-mitigated": "guardrails" }, false],
	])("%s: refused %s", (_, status, headers, refused) => {
		expect(refusedByGuardrails({ status, headers })).toBe(refused);
	});
});
