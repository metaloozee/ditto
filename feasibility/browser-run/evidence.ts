// Evidence entries for the Browser Run trial (#36), in the docs/feasibility/evidence.md format.
// Sessions are named by number. No entry may hold a session ID, a Live View link or a cookie.
import { assertClean, redactUrl } from "../takeover/redact.ts";
import { GUARDRAIL_LIMIT } from "./destinations.ts";
import type { SessionSummary } from "./worker.ts";

const ROUTE =
	"Chromium on Cloudflare Browser Run, opened by the `Workspace` Durable Object through the `BROWSER` binding with the workspace's destination list as `guardrails.allowedDomains`, driven over CDP by the take-over harness through the run-key gated Worker";

const day = (at: Date) => at.toISOString().slice(0, 10);
const time = (at: Date) => at.toISOString().slice(11, 16);
const hosts = (list: string[]) => (list.length ? list.map((h) => `\`${h}\``).join(", ") : "none");

function render(entry: {
	heading: string;
	at: Date;
	route: string;
	expected: string;
	observed: string;
	outcome: string;
	fallback: string;
}): string {
	const text = [
		`#### ${day(entry.at)} · ${entry.heading} · ${entry.outcome}`,
		"",
		`- **Route:** ${entry.route}`,
		`- **Date:** ${day(entry.at)}, ${time(entry.at)} UTC`,
		"- **Network origin:** Cloudflare Browser Run",
		`- **Expected:** ${entry.expected}`,
		`- **Observed:** ${entry.observed}`,
		"- **Retries:** _none_",
		`- **Fallback:** ${entry.fallback}`,
		"",
	].join("\n");
	assertClean(text);
	return text;
}

export type Check = {
	title: string;
	outcome: "pass" | "fail";
	route: string;
	expected: string;
	observed: string;
	compare: string;
};

export function renderChecks(checks: Check[], at: Date): string {
	return checks
		.map((check) =>
			render({
				heading: `${check.title} on Browser Run`,
				at,
				route: `${check.route}. Compared with the Containers trial: ${check.compare}`,
				expected: check.expected,
				observed: check.observed,
				outcome: check.outcome,
				fallback: check.outcome === "pass" ? "none needed" : "_owner to name_",
			}),
		)
		.join("\n");
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
	/** Hosts guardrails refused while the bot opened the task page. */
	refused: string[];
	/** Distinct hosts the task page requested. */
	requested: number;
}): string {
	const days = daysBetween(run.savedAt, run.at);
	const when =
		days === 0 ? "on the day they were saved" : `after ${days} ${days === 1 ? "day" : "days"}`;
	return render({
		heading: `${run.workflow} login restored from saved cookies ${when}`,
		at: run.at,
		route: `${ROUTE}. A new session, with the cookies the Durable Object saved on ${day(run.savedAt)} restored over \`Storage.setCookies\`, then the bot will ${run.task}, with no take-over`,
		expected:
			"the bot reaches the signed-in page without the owner. If it does not, the record states what else the site needed: local storage, a device check or a fresh sign-in",
		observed: `${run.restoredCookies} cookies restored. Bot reached the signed-in page: ${run.botSignedIn ? "yes" : "no"}, at ${redactUrl(run.finishedAt)}. Guardrails refused: ${hosts(run.refused)}. The task page requested ${run.requested} distinct hosts (guardrail limit ${GUARDRAIL_LIMIT}).`,
		outcome: run.botSignedIn ? "pass" : "fail",
		fallback: run.botSignedIn
			? "none needed"
			: "_owner to state what else the site needed (local storage, a device check, a fresh sign-in), and whether a take-over each session is acceptable_",
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
		route: `${ROUTE}. The Durable Object deletes the workspace's stored cookies and closes its session, then opens a new one and the bot opens each task page`,
		expected:
			"no cookies are restored and every workflow starts signed out (ADR-0010: deleting a specialist deletes its stored cookies)",
		observed: `${run.restoredCookies} cookies restored. ${states}.`,
		outcome: ended ? "pass" : "fail",
		fallback: ended ? "none needed" : "_owner to name_",
	});
}

const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
const hours = (seconds: number) => `${(seconds / 3600).toFixed(2)} browser-hours`;

export function sessionsEntry(run: {
	at: Date;
	workspaces: { workspace: string; sessions: SessionSummary[] }[];
	usedBrowserTimeSeconds: number | undefined;
}): string {
	const lines: string[] = [];
	let closedMs = 0;
	let closed = 0;
	for (const { workspace, sessions } of run.workspaces) {
		for (const s of sessions) {
			const name = `\`${workspace}\` session ${s.session}`;
			if (s.open || s.durationMs === undefined) {
				lines.push(`${name}: still open`);
				continue;
			}
			closed++;
			closedMs += s.durationMs;
			const code = s.closeReason === undefined ? "" : ` (${s.closeReason})`;
			lines.push(
				`${name}: ${minutes(s.durationMs)}, closed \`${s.closeReasonText ?? "unknown"}\`${code}`,
			);
		}
	}
	const account =
		run.usedBrowserTimeSeconds === undefined
			? "`limits()` reported no browser time; read the Browser Run dashboard"
			: `account total reported by \`limits()\`: ${hours(run.usedBrowserTimeSeconds)}`;
	return render({
		heading: "Trial sessions, close reasons and browser-hours",
		at: run.at,
		route: `\`history()\` and \`limits()\` on the \`BROWSER\` binding, filtered to the sessions the trial's Durable Objects opened`,
		expected: "every session the trial opened is listed with its length and `closeReason`",
		observed: `${lines.join("; ") || "no sessions"}. ${hours(closedMs / 1000)} across the ${closed} closed sessions; ${account}.`,
		outcome: "pass",
		fallback: "none needed",
	});
}
