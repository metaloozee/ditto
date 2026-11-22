// Render one workflow run as an entry in the docs/feasibility/evidence.md format.
import { grade } from "./grade.ts";
import { assertClean, redactUrl } from "./redact.ts";

export type Observation = {
	workflow: string;
	task: string;
	at: Date;
	tookOver: boolean;
	steppedThrough: boolean;
	botFinished: boolean;
	/** Where the bot found the tab when it inspected the screen after hand-back. */
	afterHandBack?: string;
	/** Where the tab was when the bot judged the task. */
	finishedAt: string;
	/** The owner's notes, in their words. */
	challenges: string;
	siteResponse: string;
	/** Hosts the filter refused during the run. Hosts only: request URLs can carry tokens. */
	denied: string[];
	/** Where the desktop ran: local Docker (#29, the default) or Cloudflare Containers (#32). */
	host?: "docker" | "cloudflare";
};

const hosts = {
	docker: {
		title: "",
		route:
			"headed Chromium in the desktop container behind the `ws-takeover` egress filter; the owner signs in through the loopback noVNC view",
		origin: "container",
	},
	cloudflare: {
		title: " on Cloudflare",
		route:
			"headed Chromium on Cloudflare Containers behind the `ws-takeover` egress filter in the same instance; the owner signs in through the noVNC view, forwarded to loopback by the run-key gated Worker",
		origin: "Cloudflare container",
	},
};

export function evidenceEntry(run: Observation): string {
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
		"- **Expected:** the owner completes only the login and any challenge; after the explicit hand-back the bot inspects the screen and finishes the task alone",
		`- **Observed:** took over: ${yesNo(run.tookOver)}. Challenges: ${run.challenges || "none"}. Site's response: ${run.siteResponse || "none recorded"}. ` +
			(run.afterHandBack ? `After hand-back the bot found ${redactUrl(run.afterHandBack)}. ` : "") +
			`Bot finished the task after hand-back: ${yesNo(run.botFinished)}, at ${redactUrl(run.finishedAt)}. ` +
			`Owner operated the site beyond the login: ${yesNo(run.steppedThrough)}. Filter denied: ${denied}.`,
		"- **Retries:** _none_",
		`- **Fallback:** ${outcome === "unsupported" ? "_owner to name: another provider that enforces the workspace destination list, or drop the workflow_" : "none needed"}`,
		"",
	].join("\n");

	assertClean(entry);
	return entry;
}
