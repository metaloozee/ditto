// Render one workflow run as an entry in the docs/feasibility/evidence.md format.
import { GUARDRAIL_LIMIT } from "../browser-run/destinations.ts";
import { grade } from "./grade.ts";
import { assertClean, redactUrl } from "./redact.ts";

export type Observation = {
	workflow: string;
	task: string;
	at: Date;
	tookOver: boolean;
	steppedThrough: boolean;
	botSignedIn: boolean;
	/** Where the bot found the tab when it inspected the screen after hand-back. */
	afterHandBack?: string;
	/** Where the tab was when the bot judged the task. */
	finishedAt: string;
	/** The owner's notes, in their words. */
	challenges: string;
	siteResponse: string;
	/** Hosts the filter refused during the run. Hosts only: request URLs can carry tokens. */
	denied: string[];
	/** Distinct hosts requested during the run. */
	requested?: number;
	/** Further answers from the owner, each rendered as its own bullet. */
	notes?: { label: string; answer: string }[];
	/** Where the desktop ran: local Docker (the default), Cloudflare Containers or Browser Run. */
	host?: "docker" | "cloudflare" | "browser-run";
};

const hosts = {
	docker: {
		title: "",
		route:
			"headed Chromium in the desktop container behind the `ws-takeover` egress filter; the owner signs in through the loopback noVNC view",
		origin: "container",
		refusals: (denied: string) => `Filter denied: ${denied}.`,
	},
	cloudflare: {
		title: " on Cloudflare",
		route:
			"headed Chromium on Cloudflare Containers behind the `ws-takeover` egress filter in the same instance; the owner signs in through the noVNC view, forwarded to loopback by the run-key gated Worker",
		origin: "Cloudflare container",
		refusals: (denied: string) => `Filter denied: ${denied}.`,
	},
	"browser-run": {
		title: " on Browser Run",
		route:
			"Chromium on Cloudflare Browser Run with the `ws-takeover` list as the session's guardrails, opened by the `Workspace` Durable Object; the owner signs in through a Live View link in tab mode. Until hand-back the harness refuses every page action; the only DevTools traffic is the Durable Object's browser-level keep-alive and the request log's network listener",
		origin: "Cloudflare Browser Run",
		refusals: (denied: string, requested?: number) =>
			`Guardrails refused: ${denied}. Hosts the page requested: ${requested ?? "unknown"}, against the ${GUARDRAIL_LIMIT}-host guardrail limit.`,
	},
};

export const ALREADY_SIGNED_IN =
	"The profile is already signed in, so this run would grade a login it never tested. Discard the profile and rerun";

export function evidenceEntry(run: Observation): string {
	// The bot never tries a login itself, so a run without take-over only reuses an old session.
	if (!run.tookOver) throw new Error(ALREADY_SIGNED_IN);
	const outcome = grade(run);
	const date = run.at.toISOString().slice(0, 10);
	const time = run.at.toISOString().slice(11, 16);
	const yesNo = (value: boolean) => (value ? "yes" : "no");
	const where = hosts[run.host ?? "docker"];
	const denied = run.denied.length ? run.denied.map((host) => `\`${host}\``).join(", ") : "none";

	const entry = [
		`#### ${date} · ${run.workflow} login with take-over${where.title} · ${outcome}`,
		"",
		`- **Route:** ${where.route}, hands back, then the bot will ${run.task}`,
		`- **Date:** ${date}, ${time} UTC`,
		`- **Network origin:** ${where.origin}`,
		"- **Expected:** the owner completes only the login and any challenge; after the explicit hand-back the bot inspects the screen and reaches the signed-in page alone. The page check proves the session carried over, not a multi-step task",
		`- **Observed:** took over: ${yesNo(run.tookOver)}. Challenges: ${run.challenges || "none"}. Site's response: ${run.siteResponse || "none recorded"}. ` +
			(run.afterHandBack ? `After hand-back the bot found ${redactUrl(run.afterHandBack)}. ` : "") +
			`Bot reached the signed-in page after hand-back: ${yesNo(run.botSignedIn)}, at ${redactUrl(run.finishedAt)}. ` +
			`Owner operated the site beyond the login: ${yesNo(run.steppedThrough)}. ${where.refusals(denied, run.requested)}`,
		...(run.notes ?? []).map(({ label, answer }) => `- **${label}:** ${answer || "none recorded"}`),
		"- **Retries:** _none_",
		`- **Fallback:** ${outcome === "unsupported" ? "_owner to name: another provider that enforces the workspace destination list, or drop the workflow_" : "none needed"}`,
		"",
	].join("\n");

	assertClean(entry);
	return entry;
}
