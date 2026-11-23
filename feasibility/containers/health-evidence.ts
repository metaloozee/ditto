// Evidence entries for the shared computer's browser health (#37), in the
// docs/feasibility/evidence.md format. No entry may hold a cookie, token or account identifier.
import type { WebSocketSession } from "../egress/probes.ts";
import { assertClean, redactUrl } from "../takeover/redact.ts";
import type { Memory } from "./checks.ts";

export type Sample = {
	at: number;
	memory: Memory;
	chromeProcesses: number;
	chromePssMib: number;
	desktop: Record<string, boolean>;
	oomKills: number | null;
	pressure: { cpu: number | null; memory: number | null };
	load1: number;
};
type Reach = { chrome: string; gate: string; lock: string };

const ROUTE =
	"headed Chromium on Cloudflare Containers behind the workspace's egress filter, owned by the `Workspace` Durable Object, driven through the run-key gated Worker";
const day = (at: Date) => at.toISOString().slice(0, 10);
const time = (at: Date) => at.toISOString().slice(11, 16);
const mib = (value: number | null | undefined) =>
	value === null || value === undefined ? "unknown" : `${Math.round(value)} MiB`;
const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
/** The instance's memory ceiling: the cgroup limit, or what the instance reports in total. */
const ceiling = (memory: Memory) => memory.limitMib ?? memory.memTotalMib;

function render(entry: {
	heading: string;
	at: Date;
	route: string;
	expected: string;
	observed: string;
	outcome: string;
	fallback?: string;
}): string {
	const text = [
		`#### ${day(entry.at)} · ${entry.heading} · ${entry.outcome}`,
		"",
		`- **Route:** ${entry.route}`,
		`- **Date:** ${day(entry.at)}, ${time(entry.at)} UTC`,
		"- **Network origin:** Cloudflare container",
		`- **Expected:** ${entry.expected}`,
		`- **Observed:** ${entry.observed}`,
		"- **Retries:** _none_",
		`- **Fallback:** ${entry.fallback ?? (entry.outcome === "pass" ? "none needed" : "_owner to name_")}`,
		"",
	].join("\n");
	assertClean(text);
	return text;
}

const peak = (values: (number | null)[]) =>
	values.reduce<number | null>((max, v) => (v === null ? max : Math.max(max ?? v, v)), null);

export function memoryEntry(run: {
	workflow: string;
	instanceType: string;
	at: Date;
	samples: Sample[];
	/** The bot reached the signed-in page after hand-back. */
	completed: boolean;
	/** The instance stopped answering before the run ended. */
	instanceGone: boolean;
}): string {
	const { samples } = run;
	const first = samples[0];
	const last = samples.at(-1);
	const lost = Object.keys(first?.desktop ?? {}).flatMap((name) => {
		const gone = samples.find((s) => first?.desktop[name] && !s.desktop[name]);
		return gone ? [`\`${name}\` gone ${seconds(gone.at - (first?.at ?? 0))} in`] : [];
	});
	const oomKills = (last?.oomKills ?? 0) - (first?.oomKills ?? 0);
	const memoryPeak = peak(samples.map((s) => s.memory.currentMib));
	const limit = last ? ceiling(last.memory) : null;
	const gap = samples
		.slice(1)
		.reduce((max, s, i) => Math.max(max, s.at - (samples[i]?.at ?? s.at)), 0);
	const readings = [
		`${samples.length} samples over ${minutes((last?.at ?? 0) - (first?.at ?? 0))}, longest gap ${seconds(gap)}`,
		`instance memory peak ${mib(memoryPeak)} of ${mib(limit)}`,
		`Chrome PSS peak ${mib(peak(samples.map((s) => s.chromePssMib)))} across up to ${peak(samples.map((s) => s.chromeProcesses)) ?? 0} processes`,
		`memory pressure peak (avg10) ${peak(samples.map((s) => s.pressure.memory)) ?? "unknown"}, CPU pressure peak ${peak(samples.map((s) => s.pressure.cpu)) ?? "unknown"}`,
		`OOM kills ${last?.oomKills === null ? "unknown" : oomKills}`,
		`desktop processes lost: ${lost.join(", ") || "none"}`,
		`instance answered to the end: ${run.instanceGone ? "no" : "yes"}`,
		`signed-in page reached: ${run.completed ? "yes" : "no"}`,
	];
	const dropped = lost.length > 0 || run.instanceGone;
	const cause =
		oomKills > 0
			? `Memory starvation confirmed: the kernel OOM-killed ${oomKills} processes.`
			: dropped
				? "Starvation not confirmed: the desktop dropped without an OOM kill; compare the pressure peaks."
				: run.completed
					? "Starvation ruled out for this run: no OOM kill and every desktop process stayed up."
					: "Starvation not confirmed: no process was lost, but the sign-in did not complete.";
	return render({
		heading: `memory and processes during the ${run.workflow} take-over on \`${run.instanceType}\``,
		at: run.at,
		route: `${ROUTE}. The instance samples cgroup memory, Chrome's proportional set size, pressure stall averages, OOM kills and the desktop's processes every 3 s; the owner's command polls them during the take-over`,
		expected:
			"the sign-in completes with Xvfb, x11vnc, websockify and Chromium alive throughout, or the samples show what starved",
		observed: `${readings.join(". ")}. ${cause}`,
		outcome: run.completed && !dropped ? "pass" : "fail",
	});
}

export function lockEntry(run: {
	at: Date;
	/** Each probe during take-over: the Worker's DevTools route status, and local reach. */
	probes: { route: number; reach: Reach }[];
	/** The same probe after hand-back. */
	after: { route: number; reach: Reach };
}): string {
	const shut = (p: { route: number; reach: Reach }) =>
		p.route === 423 &&
		p.reach.chrome === "refused" &&
		p.reach.gate === "refused" &&
		p.reach.lock === "refused";
	const leaks = run.probes.filter((p) => !shut(p));
	const reopened = run.after.route === 200 && run.after.reach.gate === "reachable";
	const pass = run.probes.length > 0 && leaks.length === 0 && reopened;
	const json = (value: unknown) => `\`${JSON.stringify(value)}\``;
	return render({
		heading: "No bot process reaches DevTools between take-over ready and hand-back",
		at: run.at,
		route: `${ROUTE}. Take-over locks the instance's DevTools gate (closing every session) before it answers ready; the fence lets only the gate's user reach Chrome's port 9222 and no local process reach the lock. Throughout the take-over the owner's command probes the Worker's DevTools route and, as the browser user standing in for a bot's process, ports 9222, 9223 and 8082`,
		expected:
			"every probe from take-over ready to hand-back is refused (route `423`, every port refused), and the gate answers again after hand-back",
		observed: `${run.probes.length} probes during take-over, ${leaks.length} reached DevTools${leaks[0] ? ` (first: ${json(leaks[0])})` : ""}. After hand-back: ${json(run.after)}.`,
		outcome: pass ? "pass" : "fail",
	});
}

/** Calendar days, in UTC, from the save to the restore. */
function daysBetween(from: Date, to: Date): number {
	return Math.round((Date.parse(day(to)) - Date.parse(day(from))) / (24 * 60 * 60_000));
}

export function restoreEntry(run: {
	workflow: string;
	task: string;
	at: Date;
	savedAt: Date;
	restoredCookies: number;
	botSignedIn: boolean;
	finishedAt: string;
	denied: string[];
}): string {
	const days = daysBetween(run.savedAt, run.at);
	const when =
		days === 0 ? "on the day they were saved" : `after ${days} ${days === 1 ? "day" : "days"}`;
	const denied = run.denied.length ? run.denied.map((h) => `\`${h}\``).join(", ") : "none";
	return render({
		heading: `${run.workflow} login restored from saved cookies ${when}`,
		at: run.at,
		route: `${ROUTE}. A new instance, with the cookies the Durable Object saved on ${day(run.savedAt)} restored over \`Storage.setCookies\` before start answered, then the bot will ${run.task}, with no take-over`,
		expected:
			"the bot reaches the signed-in page without the owner. If it does not, the record states what else the site needed: local storage, a device check or a fresh sign-in",
		observed: `${run.restoredCookies} cookies restored. Bot reached the signed-in page: ${run.botSignedIn ? "yes" : "no"}, at ${redactUrl(run.finishedAt)}. Filter denied: ${denied}.`,
		outcome: run.botSignedIn ? "pass" : "fail",
		fallback: run.botSignedIn
			? "none needed"
			: "_owner to state what else the site needed (local storage, a device check, a fresh sign-in)_",
	});
}

export function forgetEntry(run: {
	at: Date;
	restoredCookies: number;
	signedIn: Record<string, boolean>;
}): string {
	const ended = Object.values(run.signedIn).every((signedIn) => !signedIn);
	const states = Object.entries(run.signedIn)
		.map(([workflow, signedIn]) => `${workflow}: ${signedIn ? "still signed in" : "signed out"}`)
		.join(", ");
	return render({
		heading: "Deleting the stored cookies ends the login",
		at: run.at,
		route: `${ROUTE}. The Durable Object deletes the workspace's stored cookies and the instance is destroyed without saving; a new instance starts and the bot opens each task page`,
		expected:
			"no cookies are restored and every workflow starts signed out (ADR-0010: deleting a specialist deletes its stored cookies)",
		observed: `${run.restoredCookies} cookies restored. ${states}.`,
		outcome: ended ? "pass" : "fail",
	});
}

export function idleEntry(run: {
	at: Date;
	instanceType: string;
	heldMs: number;
	/** Still running when the hold was released. */
	survivedHold: boolean;
	/** From the last use to the first status that showed it stopped; null if it never stopped. */
	idleSurvivedMs: number | null;
	waitedMs: number;
	pollMs: number;
}): string {
	const stopped = run.idleSurvivedMs !== null;
	return render({
		heading: `idle instance stops only when nothing holds or uses it on \`${run.instanceType}\``,
		at: run.at,
		route: `${ROUTE}. A task hold, with nothing using the instance and the owner's command reading only the Durable Object's status, which neither touches nor keeps the instance. Then the hold is released`,
		expected:
			"the instance stays up for the whole hold (longer than the object's 5-minute `sleepAfter` and Cloudflare's own idle stop), then the object saves the cookies and stops it about 5 minutes after the release",
		observed: `held ${minutes(run.heldMs)}: ${run.survivedHold ? "still running at release" : "stopped during the hold"}. After release: ${stopped ? `stopped ${seconds(run.idleSurvivedMs ?? 0)} after its last use (status read every ${seconds(run.pollMs)})` : `still running after ${minutes(run.waitedMs)}`}.`,
		outcome: run.survivedHold && stopped ? "pass" : "fail",
	});
}

export function capacityEntry(run: {
	at: Date;
	instanceType: string;
	url: string;
	steps: { screens: number; alive: boolean; memory: Memory }[];
}): string {
	let fits = 0;
	for (const step of run.steps) {
		const limit = ceiling(step.memory);
		if (!step.alive || limit === null || step.memory.currentMib > 0.9 * limit) break;
		fits = step.screens;
	}
	const table = run.steps
		.map(
			(s) =>
				`${s.screens} extra: ${mib(s.memory.currentMib)} of ${mib(ceiling(s.memory))}, ${s.alive ? "all alive" : "a screen or the main Chrome died"}`,
		)
		.join("; ");
	return render({
		heading: `screens per instance on \`${run.instanceType}\``,
		at: run.at,
		route: `${ROUTE}. Beside the main screen, the instance opens one more screen at a time (its own Xvfb display and Chrome profile, loading \`${redactUrl(run.url)}\`), waits 30 s and samples memory`,
		expected:
			"a count of screens that stay alive with instance memory under 90% of its ceiling; the decision record commits capacity from this",
		observed: `${table}. **Screens that fit:** ${fits} beside the main screen (${fits + 1} in all).`,
		outcome: "pass",
	});
}

export function socketEntry(run: {
	at: Date;
	holdMs: number;
	active: WebSocketSession;
	idle: { opened: boolean; openForMs: number; openAtEnd: boolean; closeCode: number | null };
	upgradeAllowed: boolean;
}): string {
	const { active, idle } = run;
	const pass =
		active.opened &&
		active.openAtEnd &&
		active.closeCode === null &&
		active.openForMs >= run.holdMs &&
		active.echoed === active.sent &&
		run.upgradeAllowed;
	return render({
		heading: `WebSocket held ${minutes(run.holdMs)} through the filter, with its idle timeout`,
		at: run.at,
		route: `${ROUTE}. The page opens two sockets to \`wss://echo.websocket.org/\`: one pings every 10 s for the hold, one sends nothing after its greeting. The filter runs mitmproxy 12.3.1 with its default \`tcp_timeout\` of 600 s`,
		expected:
			"the active socket stays open with every ping echoed; the idle socket shows the idle timeout of the filter or the far end, if any",
		observed: `active: ${active.echoed} of ${active.sent} pings echoed, open for ${minutes(active.openForMs)}, open at end: ${active.openAtEnd}, close code ${active.closeCode ?? "none"}. Idle: ${idle.openAtEnd ? `still open after ${minutes(idle.openForMs)}` : `closed after ${seconds(idle.openForMs)} with code ${idle.closeCode ?? "none"}`}. Filter logged the WebSocket allow: ${run.upgradeAllowed ? "yes" : "no"}.`,
		outcome: pass ? "pass" : "fail",
	});
}
