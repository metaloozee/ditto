// The #37 evidence entries: each grade must follow what was observed, not what was hoped.
import { describe, expect, it } from "vite-plus/test";

import {
	capacityEntry,
	lockEntry,
	memoryEntry,
	restoreEntry,
	type Sample,
} from "./containers/health-evidence.ts";

const at = new Date("2026-11-25T10:00:00Z");
const desktop = { Xvfb: true, x11vnc: true, websockify: true, chromium: true };
const sample = (seconds: number, over: Partial<Sample> = {}): Sample => ({
	at: at.getTime() + seconds * 1000,
	memory: { currentMib: 900, peakMib: null, limitMib: null, memTotalMib: 4096 },
	chromeProcesses: 9,
	chromePssMib: 700,
	desktop,
	oomKills: 0,
	pressure: { cpu: 3, memory: 0 },
	load1: 0.5,
	...over,
});

describe("memory during a take-over", () => {
	it("confirms starvation when the kernel killed a process, and names what the desktop lost", () => {
		const entry = memoryEntry({
			workflow: "LinkedIn",
			instanceType: "standard-1",
			at,
			completed: false,
			instanceGone: true,
			samples: [
				sample(0),
				sample(3, {
					memory: { currentMib: 4000, peakMib: null, limitMib: null, memTotalMib: 4096 },
				}),
				sample(6, { desktop: { ...desktop, x11vnc: false }, oomKills: 1 }),
			],
		});

		expect(entry).toMatch(/· fail$/m);
		expect(entry).toContain("starvation confirmed");
		expect(entry).toContain("`x11vnc` gone");
		expect(entry).toContain("4000 MiB");
	});

	it("rules starvation out only for a run that completed with every desktop process alive", () => {
		const entry = memoryEntry({
			workflow: "LinkedIn",
			instanceType: "standard-1",
			at,
			completed: true,
			instanceGone: false,
			samples: [sample(0), sample(3, { chromePssMib: 1500 })],
		});

		expect(entry).toMatch(/· pass$/m);
		expect(entry).toContain("ruled out");
		expect(entry).toContain("1500 MiB");
	});

	it("does not rule starvation out when the display dropped without an OOM kill", () => {
		const entry = memoryEntry({
			workflow: "LinkedIn",
			instanceType: "standard-1",
			at,
			completed: false,
			instanceGone: false,
			samples: [sample(0), sample(3, { desktop: { ...desktop, Xvfb: false } })],
		});

		expect(entry).toMatch(/· fail$/m);
		expect(entry).not.toContain("ruled out");
		expect(entry).toContain("not confirmed");
	});
});

describe("DevTools between take-over ready and hand-back", () => {
	const closed = { route: 423, reach: { chrome: "refused", gate: "refused", lock: "refused" } };
	const after = { route: 200, reach: { chrome: "refused", gate: "reachable", lock: "refused" } };

	it("passes only when every probe in the window was refused, and DevTools came back after", () => {
		expect(lockEntry({ at, probes: [closed, closed], after })).toMatch(/· pass$/m);
		expect(lockEntry({ at, probes: [closed], after: { ...after, route: 423 } })).toMatch(
			/· fail$/m,
		);
		expect(
			lockEntry({
				at,
				probes: [closed, { ...closed, reach: { ...closed.reach, chrome: "reachable" } }],
				after,
			}),
		).toMatch(/· fail$/m);
		expect(lockEntry({ at, probes: [], after })).toMatch(/· fail$/m);
	});
});

describe("restored logins", () => {
	const run = {
		workflow: "Google",
		task: "open Google Account home and confirm it is signed in",
		restoredCookies: 31,
		botSignedIn: true,
		finishedAt: "https://myaccount.google.com/?pli=1",
		denied: [],
	};

	it("labels a restore on the day of the save, which does not count", () => {
		const entry = restoreEntry({ ...run, at, savedAt: new Date("2026-11-25T08:00:00Z") });
		expect(entry).toContain("on the day they were saved");
	});

	it("counts the days to a later restore and grades by the bot's own check", () => {
		const entry = restoreEntry({
			...run,
			botSignedIn: false,
			at,
			savedAt: new Date("2026-11-23T08:00:00Z"),
		});
		expect(entry).toContain("after 2 days");
		expect(entry).toMatch(/· fail$/m);
		expect(entry).not.toContain("pli=1");
	});
});

describe("screens per instance", () => {
	it("names the most screens that stayed alive under 90% of the instance's memory", () => {
		const step = (screens: number, currentMib: number, alive = true) => ({
			screens,
			alive,
			memory: { currentMib, peakMib: null, limitMib: null, memTotalMib: 4096 },
		});

		const entry = capacityEntry({
			at,
			instanceType: "standard-1",
			url: "https://www.linkedin.com/login",
			steps: [step(1, 1500), step(2, 2600), step(3, 3800), step(4, 4000, false)],
		});

		expect(entry).toContain("**Screens that fit:** 2");
	});
});
