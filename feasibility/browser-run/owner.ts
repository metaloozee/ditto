// Owner commands for the workspace browser on Cloudflare Browser Run (#36). Live: they deploy to
// the owner's Cloudflare account, which must be on Workers Paid, and open billed browser sessions.
//   pnpm feasibility:browser-run deploy
//   pnpm feasibility:browser-run checks [--ws-hold-ms 65000]   reuse, allow, refuse, WebSocket, HTTP/2
//   pnpm feasibility:browser-run takeover <google|linkedin> [--live-view-minutes 10]
//   pnpm feasibility:browser-run restore <google|linkedin>     on a later date: new session, saved cookies
//   pnpm feasibility:browser-run forget                        delete the cookies, prove the login ends
//   pnpm feasibility:browser-run sessions                      lengths, close reasons, browser-hours
//   pnpm feasibility:browser-run close [ws-takeover|ws-cloud-trial]
//   pnpm feasibility:browser-run destroy
// Progress goes to stderr. Evidence entries go to stdout.
import { rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { serveLoopback } from "../containers/loopback.ts";
import {
	HTTP2_PAGE,
	http2Probe,
	WEBSOCKET_PAGE,
	type WebSocketSession,
	websocketProbe,
} from "../egress/probes.ts";
import {
	alchemy,
	configDir,
	deployedUrl,
	runKey,
	savedRunKey,
	type Stack,
} from "../owner-stage.ts";
import { Tab } from "../takeover/cdp.ts";
import { takeOverWorkflow } from "../takeover/flow.ts";
import { workflows, type WorkflowId } from "../takeover/workflows.ts";
import type { WorkspaceId } from "./destinations.ts";
import { type Check, forgetEntry, renderChecks, restoreEntry, sessionsEntry } from "./evidence.ts";
import { RequestLog } from "./request-log.ts";
import type { SessionSummary } from "./worker.ts";

const STACK: Stack = {
	dir: import.meta.dirname,
	name: "ditto-browser-run-trial",
	stage: "browser-run-trial",
};
const runKeyFile = path.join(configDir, "browser-run-run-key");
// Losing this key loses the stored logins; the next take-over saves new ones.
const cookieKeyFile = path.join(configDir, "browser-run-cookie-key");
const DEPLOY = "pnpm feasibility:browser-run deploy";
/** Only these logins are trialled on Browser Run; the protected site has no test account. */
const TRIAL_WORKFLOWS = ["google", "linkedin"] as const satisfies WorkflowId[];
const SLOT = "Desktop provider > Browser Run trial (#36) in docs/feasibility/decision-record.md";

const log = (message: string) => console.error(`[browser-run] ${message}`);

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		"worker-url": { type: "string" },
		"ws-hold-ms": { type: "string", default: "65000" },
		"live-view-minutes": { type: "string", default: "10" },
	},
});

type Opened = {
	reused: boolean;
	session: number;
	restoredCookies: number;
	cookiesSavedAt?: number;
};

async function target() {
	const url = values["worker-url"] ?? (await deployedUrl(STACK));
	if (!url) throw new Error(`The Browser Run stage isn't deployed. Run: ${DEPLOY}`);
	const key = process.env.TRIAL_RUN_KEY ?? (await savedRunKey(runKeyFile, DEPLOY));
	const call = async (pathname: string, method = "GET") => {
		const response = await fetch(new URL(pathname, url), {
			method,
			headers: { "x-trial-key": key },
		});
		if (!response.ok)
			throw new Error(`${method} ${pathname}: ${response.status} ${await response.text()}`);
		return response;
	};
	const json = async <T>(pathname: string, method = "GET") =>
		(await (await call(pathname, method)).json()) as T;
	return { url, key, call, json };
}

type Target = Awaited<ReturnType<typeof target>>;

async function open(t: Target, workspace: WorkspaceId): Promise<Opened> {
	const opened = await t.json<Opened>(`/w/${workspace}/session`, "POST");
	log(
		opened.reused
			? `Reconnected to ${workspace} session ${opened.session}.`
			: `Opened ${workspace} session ${opened.session} with ${opened.restoredCookies} cookies restored.`,
	);
	return opened;
}

/** The owner's DevTools doorway: the Worker's devtools route on 127.0.0.1:9222, key added. */
const doorway = (t: Target, workspace: WorkspaceId) =>
	serveLoopback({ workerUrl: t.url, workspace, route: "devtools", port: 9222, key: t.key });

async function save(t: Target, workspace: WorkspaceId) {
	const saved = await t.json<{ cookies: number; domains: string[] }>(
		`/w/${workspace}/cookies/save`,
		"POST",
	);
	log(
		`Saved ${saved.cookies} cookies for ${saved.domains.length} domains, encrypted in the Durable Object.`,
	);
}

async function deploy() {
	log(
		"Deploying to your Cloudflare account. Browser Run bills browser-hours above the 10 included",
	);
	log("in Workers Paid; the Durable Object closes an idle session after 18 minutes.");
	const code = await alchemy(STACK, "deploy", {
		TRIAL_RUN_KEY: await runKey(runKeyFile),
		COOKIE_KEY: await runKey(cookieKeyFile),
	});
	if (code !== 0) process.exit(code);
	log("Deployed. Run the checks with: pnpm feasibility:browser-run checks");
}

async function checks() {
	const t = await target();
	const workspace = "ws-cloud-trial";
	const at = new Date();
	const holdMs = Number(values["ws-hold-ms"]);
	// Always a new session, so the reuse check starts from a launch.
	await t.call(`/w/${workspace}/close`, "POST");
	const first = await open(t, workspace);
	const second = await open(t, workspace);
	const entries: Check[] = [
		{
			title: "session reused across Durable Object requests",
			outcome: !first.reused && second.reused && first.session === second.session ? "pass" : "fail",
			route: `two \`POST /w/${workspace}/session\` requests to the \`Workspace\` Durable Object: the first launches with \`keepAlive\` at 20 minutes, the second finds the stored session ID live and reconnects with \`connectSession\``,
			expected: "one browser launched; the second request reuses its session",
			observed: `first request: ${first.reused ? "reused" : "launched"} session ${first.session}. Second: ${second.reused ? "reused" : "launched"} session ${second.session}.`,
			compare: "a Container instance is reused while running, and stops after 3 to 5 idle minutes",
		},
	];

	const devtools = await doorway(t, workspace);
	const requests = await RequestLog.attach(devtools.url);
	const tab = await Tab.open(devtools.url);
	try {
		log("Loading an approved destination…");
		await tab.goto("https://example.com/");
		const title = await tab.evaluate<string>("document.title");
		const allowed = requests.document("example.com");
		entries.push({
			title: "Guardrails load an approved destination",
			outcome:
				title === "Example Domain" && allowed?.status === 200 && !allowed.refused ? "pass" : "fail",
			route: `the session's page loads \`https://example.com/\` with \`example.com\` in \`guardrails.allowedDomains\``,
			expected: "the page loads with status 200",
			observed: `document title \`${title}\`, status ${allowed?.status ?? "none seen"}.`,
			compare: "#32: pass, the filter logged the allow with `ws-cloud-trial`",
		});

		log("Loading an unapproved destination…");
		const navigation = await tab
			.goto("https://example.org/")
			.then(() => "loaded")
			.catch((error: Error) => error.message);
		const refused = requests.document("example.org");
		entries.push({
			title: "Guardrails refuse an unapproved destination",
			outcome: refused?.refused ? "pass" : "fail",
			route: "the same page loads `https://example.org/`, which is not in the list",
			expected: "Browser Run answers 403 with `cf-mitigated: guardrails`",
			observed: `navigation ${navigation}; status ${refused?.status ?? "none seen"}, \`cf-mitigated: guardrails\` ${refused?.refused ? "present" : "absent"}.`,
			compare: "#32: pass, `net::ERR_TUNNEL_CONNECTION_FAILED` and a deny logged",
		});

		log(`Holding a WebSocket for ${holdMs} ms…`);
		await tab.goto(WEBSOCKET_PAGE);
		const ws = await tab.evaluate<WebSocketSession>(websocketProbe(holdMs));
		const wsPass =
			ws.opened &&
			ws.openAtEnd &&
			ws.closeCode === null &&
			ws.openForMs >= holdMs &&
			ws.sent >= 2 &&
			ws.echoed === ws.sent;
		entries.push({
			title: "WebSocket held open under guardrails",
			outcome: wsPass ? "pass" : "fail",
			route: `the page opens \`${WEBSOCKET_PAGE}\`, then \`wss://echo.websocket.org/\`, pinging every 2 seconds for ${holdMs} ms`,
			expected: "the socket opens, every ping is echoed and it is still open at the end",
			observed: `opened: ${ws.opened}, ${ws.echoed} of ${ws.sent} pings echoed, open for ${ws.openForMs} ms, open at end: ${ws.openAtEnd}, close code: ${ws.closeCode ?? "none"}.`,
			compare: "#32: pass through the filter",
		});

		log("Checking HTTP/2…");
		await tab.goto(`${HTTP2_PAGE}?h2=${Date.now()}`);
		const protocol = await tab.evaluate<string>(http2Probe);
		entries.push({
			title: "HTTP/2 negotiated under guardrails",
			outcome: protocol === "h2" ? "pass" : "fail",
			route: `the page loads \`${HTTP2_PAGE}\``,
			expected: "Chrome negotiates `h2` with the origin",
			observed: `\`nextHopProtocol\` was \`${protocol}\`.`,
			compare: "#32: pass, `h2` on both legs of the filter",
		});
	} finally {
		tab.close();
		requests.close();
		await devtools.close();
		await t.call(`/w/${workspace}/close`, "POST");
		log(`Closed the ${workspace} session.`);
	}
	log(`Paste these entries under ${SLOT}:`);
	process.stdout.write(renderChecks(entries, at));
}

function trialWorkflow(id: string | undefined, command: string) {
	if (!TRIAL_WORKFLOWS.includes(id as (typeof TRIAL_WORKFLOWS)[number])) {
		console.error(`Usage: pnpm feasibility:browser-run ${command} <${TRIAL_WORKFLOWS.join("|")}>`);
		process.exit(2);
	}
	return workflows[id as (typeof TRIAL_WORKFLOWS)[number]];
}

async function takeover(id: string | undefined) {
	const workflow = trialWorkflow(id, "takeover");
	const minutes = Number(values["live-view-minutes"]);
	const t = await target();
	await open(t, "ws-takeover");
	const view = await t.json<{ url: string; expiresInMs: number }>(
		`/w/ws-takeover/live-view?minutes=${minutes}`,
		"POST",
	);
	const devtools = await doorway(t, "ws-takeover");
	const requests = await RequestLog.attach(devtools.url);
	// Whether Live View input counts as activity is undocumented. The keep-alive is a browser-level
	// command from the Durable Object, never a page action, and it pushes the idle save back.
	const keepAlive = setInterval(() => {
		t.call("/w/ws-takeover/keepalive", "POST").catch((error: Error) =>
			log(`Keep-alive: ${error.message}`),
		);
	}, 60_000);
	try {
		log(
			`The Live View link is a credential: it controls the signed-in browser. Connect within ${minutes} min.`,
		);
		const entry = await takeOverWorkflow({
			workflow,
			devtools: devtools.url,
			viewUrl: view.url,
			decisions: async () => requests.decisions(),
			host: "browser-run",
			questions: [
				{
					label: "Live View typing",
					question:
						"Did typing in Live View reach the page (keys, paste, codes)? Note anything that did not: ",
				},
				{
					label: "Live View link",
					question: `How long did the link stay usable? It had to be opened within ${minutes} min: `,
				},
				{
					label: "Bot actions during take-over",
					question:
						"Did the page move or change on its own while you held it? (no, or what you saw): ",
				},
			],
			log,
		});
		await save(t, "ws-takeover");
		log(`Paste this entry under ${SLOT} > ${workflow.name}:`);
		process.stdout.write(entry);
		log(
			"The session stays open for the next workflow. The Durable Object saves and closes it after 18 idle minutes.",
		);
		log("On a later date: pnpm feasibility:browser-run restore <google|linkedin>");
	} finally {
		clearInterval(keepAlive);
		requests.close();
		await devtools.close();
	}
}

async function restore(id: string | undefined) {
	const workflow = trialWorkflow(id, "restore");
	const t = await target();
	// Cookies were saved after hand-back; closing proves the login survives without this browser.
	await t.call("/w/ws-takeover/close", "POST");
	const opened = await open(t, "ws-takeover");
	if (!opened.restoredCookies || !opened.cookiesSavedAt) {
		await t.call("/w/ws-takeover/close", "POST");
		throw new Error("No stored cookies to restore. Run takeover first.");
	}
	const at = new Date();
	const devtools = await doorway(t, "ws-takeover");
	const requests = await RequestLog.attach(devtools.url);
	const tab = await Tab.open(devtools.url);
	try {
		log(`Bot opens ${workflow.task.url} without the owner…`);
		await tab.goto(workflow.task.url);
		const botSignedIn = await tab.waitFor(workflow.task.done, 15_000);
		const finishedAt = await tab.evaluate<string>("location.href");
		const { requested, refused } = requests.since(0);
		log(`Paste this entry under ${SLOT} > ${workflow.name}:`);
		process.stdout.write(
			restoreEntry({
				workflow: workflow.name,
				task: workflow.task.describe,
				at,
				savedAt: new Date(opened.cookiesSavedAt),
				restoredCookies: opened.restoredCookies,
				botSignedIn,
				finishedAt,
				refused,
				requested: requested.length,
			}),
		);
	} finally {
		tab.close();
		requests.close();
		await devtools.close();
		// Closing does not save: the take-over's cookies and their date stay as the next restore's
		// source, and a failed restore's cookies never replace them through the idle save.
		await t.call("/w/ws-takeover/close", "POST");
	}
}

async function forget() {
	const t = await target();
	const at = new Date();
	await t.call("/w/ws-takeover/cookies", "DELETE");
	await t.call("/w/ws-takeover/close", "POST");
	log("Deleted the stored cookies and closed the session.");
	const opened = await open(t, "ws-takeover");
	const devtools = await doorway(t, "ws-takeover");
	const tab = await Tab.open(devtools.url);
	const signedIn: Record<string, boolean> = {};
	try {
		for (const id of TRIAL_WORKFLOWS) {
			const { name, task } = workflows[id];
			await tab.goto(task.url);
			signedIn[name] = await tab.waitFor(task.done, 15_000);
		}
	} finally {
		tab.close();
		await devtools.close();
		await t.call("/w/ws-takeover/close", "POST");
	}
	log(`Paste this entry under ${SLOT} > Deleting the stored cookies:`);
	process.stdout.write(forgetEntry({ at, restoredCookies: opened.restoredCookies, signedIn }));
}

async function sessions() {
	const t = await target();
	const reports = await Promise.all(
		(["ws-cloud-trial", "ws-takeover"] as const).map((workspace) =>
			t.json<{ workspace: string; sessions: SessionSummary[]; usedBrowserTimeSeconds?: number }>(
				`/w/${workspace}/sessions`,
			),
		),
	);
	log(`Paste this entry under ${SLOT} > Sessions and browser-hours:`);
	process.stdout.write(
		sessionsEntry({
			at: new Date(),
			workspaces: reports,
			usedBrowserTimeSeconds: reports[0]?.usedBrowserTimeSeconds,
		}),
	);
}

async function close(workspace = "ws-takeover") {
	if (workspace !== "ws-takeover" && workspace !== "ws-cloud-trial") {
		console.error("Usage: pnpm feasibility:browser-run close [ws-takeover|ws-cloud-trial]");
		process.exit(2);
	}
	const t = await target();
	await t.call(`/w/${workspace}/close`, "POST");
	log(`Closed the ${workspace} session. Cookies saved earlier stay stored.`);
}

async function destroy() {
	// A session outlives the Worker until Browser Run's idle timeout, so close both first.
	const t = await target().catch(() => undefined);
	for (const workspace of ["ws-cloud-trial", "ws-takeover"]) {
		await t?.call(`/w/${workspace}/close`, "POST").catch(() => undefined);
	}
	// The stack declaration still runs on destroy, so it needs values. They never reach Cloudflare.
	const code = await alchemy(STACK, "destroy", { TRIAL_RUN_KEY: "unused", COOKIE_KEY: "unused" });
	const now = new Date().toISOString();
	if (code === 0) {
		await rm(runKeyFile, { force: true });
		await rm(cookieKeyFile, { force: true });
	}
	log(`Paste this entry under ${SLOT} > Teardown:`);
	process.stdout.write(
		[
			"",
			`##### ${now.slice(0, 10)} · Browser Run trial stage torn down · ${code === 0 ? "pass" : "fail"}`,
			"",
			`- **Date:** ${now.slice(0, 10)}, ${now.slice(11, 16)} UTC`,
			`- **Command:** \`pnpm feasibility:browser-run destroy\`, \`alchemy destroy --stage ${STACK.stage}\` exited ${code}`,
			`- **Removed:** Worker \`ditto-${STACK.stage}-workspaces\`, its \`Workspace\` Durable Object namespace with the stored cookies, and the run-key and cookie-key secrets${code === 0 ? ", and the local keys" : ""}. Both sessions were closed first.`,
			"",
		].join("\n"),
	);
	if (code !== 0) process.exit(code);
}

const [name, arg] = positionals;
if (name === "deploy") await deploy();
else if (name === "checks") await checks();
else if (name === "takeover") await takeover(arg);
else if (name === "restore") await restore(arg);
else if (name === "forget") await forget();
else if (name === "sessions") await sessions();
else if (name === "close") await close(arg);
else if (name === "destroy") await destroy();
else {
	console.error(
		"Usage: pnpm feasibility:browser-run deploy | checks [--ws-hold-ms 65000] | takeover <google|linkedin> [--live-view-minutes 10] | restore <google|linkedin> | forget | sessions | close [workspace] | destroy",
	);
	process.exit(2);
}
