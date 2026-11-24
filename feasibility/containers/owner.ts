// Owner commands for Chrome and the egress filter on Cloudflare Containers (#32), and its health
// (#37). Live: they deploy to the owner's Cloudflare account, which must be on Workers Paid, and
// run billed instances.
//   pnpm feasibility:containers deploy --spending-cap-set [--instance standard-1]
//   pnpm feasibility:containers checks [--ws-hold-ms 65000]   allow, deny, fence, WebSocket, HTTP/2, sandbox
//   pnpm feasibility:containers takeover <google|linkedin|protected>   with DevTools lock and sampling
//   pnpm feasibility:containers restore <google|linkedin>     a new instance, saved cookies, no owner
//   pnpm feasibility:containers forget                        delete the cookies; both must be signed out
//   pnpm feasibility:containers idle [--hold-minutes 8]       held, then released until it stops
//   pnpm feasibility:containers screens [--max 6]             screens per instance
//   pnpm feasibility:containers socket [--minutes 30]         a long WebSocket and the idle timeout
//   pnpm feasibility:containers stop [ws-cloud-trial|ws-takeover]
//   pnpm feasibility:containers destroy
// Progress goes to stderr. Evidence entries go to stdout. `--worker-url` points the commands at
// another stage, such as `alchemy dev`, with its run key in TRIAL_RUN_KEY.
import { rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { WEBSOCKET_PAGE, type WebSocketSession } from "../egress/probes.ts";
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
import {
	CHECK_WORKSPACE,
	type Decision,
	type Memory,
	renderChecks,
	runChecks,
	type Started,
} from "./checks.ts";
import {
	capacityEntry,
	forgetEntry,
	idleEntry,
	lockEntry,
	memoryEntry,
	restoreEntry,
	type Sample,
	socketEntry,
} from "./health-evidence.ts";
import { serveLoopback } from "./loopback.ts";

const STACK: Stack = {
	dir: import.meta.dirname,
	name: "ditto-containers-trial",
	stage: "containers-trial",
};
const keyFiles = {
	run: path.join(configDir, "containers-run-key"),
	cookie: path.join(configDir, "containers-cookie-key"),
	session: path.join(configDir, "containers-owner-session-key"),
};
const INSTANCE_TYPES = ["lite", "basic", "standard-1", "standard-2", "standard-3", "standard-4"];
const TAKEOVER = "ws-takeover";
const SLOT = "Desktop provider > Browser health on the shared computer (#37)";
const LOGINS: WorkflowId[] = ["google", "linkedin"];
// echo.websocket.org ends every connection at about 10 minutes. From the home network on
// 2026-11-24 this one held a busy and a silent socket for 36, so an early close is not the far end.
const LONG_SOCKET_HOST = "echo.websocket.in";

const log = (message: string) => console.error(`[containers] ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		"worker-url": { type: "string" },
		"spending-cap-set": { type: "boolean", default: false },
		instance: { type: "string", default: "standard-1" },
		"ws-hold-ms": { type: "string", default: "65000" },
		"hold-minutes": { type: "string", default: "8" },
		"wait-minutes": { type: "string", default: "15" },
		max: { type: "string", default: "6" },
		url: { type: "string", default: "https://www.linkedin.com/login" },
		minutes: { type: "string", default: "30" },
	},
});

async function target() {
	const url = values["worker-url"] ?? (await deployedUrl(STACK));
	if (!url)
		throw new Error("The Containers stage isn't deployed. Run: pnpm feasibility:containers deploy");
	const key =
		process.env.TRIAL_RUN_KEY ??
		(await savedRunKey(keyFiles.run, "pnpm feasibility:containers deploy"));
	const local = ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
	const raw = (pathname: string, method = "GET") =>
		fetch(new URL(pathname, url), { method, headers: { "x-trial-key": key } });
	const call = async (pathname: string, method = "GET") => {
		const response = await raw(pathname, method);
		if (!response.ok)
			throw new Error(`${method} ${pathname}: ${response.status} ${await response.text()}`);
		return response;
	};
	const json = async <T>(pathname: string, method = "GET") =>
		(await (await call(pathname, method)).json()) as T;
	return { url, key, local, raw, call, json };
}

type Target = Awaited<ReturnType<typeof target>>;
type Status = {
	running: boolean;
	holds: string[];
	lastActivityAt?: number;
	cookiesSavedAt?: number;
};
type Opened = Started & { restoredCookies: number; cookiesSavedAt?: number };

const decisionsOf = (t: Target, workspace: string) => async () =>
	(await (await t.call(`/w/${workspace}/control/decisions`)).text())
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as Decision);

async function start(t: Target, workspace: string): Promise<Opened> {
	log(`Starting ${workspace}. A cold start can include pulling the image…`);
	const started = await t.json<Opened>(`/w/${workspace}/start`, "POST");
	log(
		started.startupMs === undefined
			? `${workspace} was already running.`
			: `Ready in ${started.startupMs} ms on ${started.instanceType}, ${started.restoredCookies} cookies restored.`,
	);
	return started;
}

/** Destroys the instance without saving, so the last saved cookies stay the source. */
const discard = (t: Target, workspace: string) => t.call(`/w/${workspace}/discard`, "POST");

function trialWorkflow(id: string | undefined, command: string, allowed: string[]) {
	if (!id || !allowed.includes(id)) {
		console.error(`Usage: pnpm feasibility:containers ${command} <${allowed.join("|")}>`);
		process.exit(2);
	}
	return workflows[id as WorkflowId];
}

async function deploy() {
	if (!values["spending-cap-set"]) {
		log("Set a spending cap first. Containers bill memory, CPU and disk above the included");
		log("amount and Chrome uses a lot of memory. In the Cloudflare dashboard, add a billing");
		log("budget alert on Workers Paid usage, then rerun with --spending-cap-set.");
		log(
			"See Desktop provider > Cloudflare Containers trial (#32) in docs/feasibility/decision-record.md.",
		);
		process.exit(2);
	}
	const github = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "OWNER_GITHUB_ID"] as const;
	const missing = github.filter((name) => !process.env[name]);
	if (missing.length) {
		log(`The take-over view needs your GitHub sign-in. Missing: ${missing.join(", ")}.`);
		log("Create a GitHub OAuth app (Settings > Developer settings > OAuth Apps). Its callback");
		log("URL is <worker url>/auth/callback; set any URL now and fix it after the first deploy.");
		log("OWNER_GITHUB_ID is your numeric ID: gh api user --jq .id");
		process.exit(2);
	}
	const instance = values.instance ?? "standard-1";
	if (!INSTANCE_TYPES.includes(instance))
		throw new Error(`--instance must be one of ${INSTANCE_TYPES.join(", ")}`);
	log(
		`Deploying to your Cloudflare account with ${instance} instances, at most 2, each destroyed after 60 minutes.`,
	);
	const code = await alchemy(STACK, "deploy", {
		TRIAL_RUN_KEY: await runKey(keyFiles.run),
		COOKIE_KEY: await runKey(keyFiles.cookie),
		OWNER_SESSION_KEY: await runKey(keyFiles.session),
		INSTANCE_TYPE: instance,
		...Object.fromEntries(github.map((name) => [name, process.env[name] ?? ""])),
	});
	if (code !== 0) process.exit(code);
	const url = await deployedUrl(STACK);
	log(`Deployed. Set your GitHub OAuth app's callback URL to ${url}/auth/callback`);
	log("Then run the checks with: pnpm feasibility:containers checks");
}

async function checks() {
	const t = await target();
	// Always a cold start, so the startup time is comparable between runs.
	await discard(t, CHECK_WORKSPACE);
	const started = await start(t, CHECK_WORKSPACE);
	const at = new Date();
	// DevTools hands back WebSocket URLs on 127.0.0.1:9222, so the doorway must listen there.
	const devtools = await serveLoopback({
		workerUrl: t.url,
		workspace: CHECK_WORKSPACE,
		route: "devtools",
		port: 9222,
		key: t.key,
	});
	try {
		const results = await runChecks(
			{
				devtools: devtools.url,
				decisions: decisionsOf(t, CHECK_WORKSPACE),
				control: async (p) => (await t.call(`/w/${CHECK_WORKSPACE}/control${p}`)).json(),
			},
			started,
			{ holdMs: Number(values["ws-hold-ms"]), log },
		);
		log(
			"Paste these entries under Desktop provider > Cloudflare Containers trial (#32) in docs/feasibility/decision-record.md:",
		);
		process.stdout.write(renderChecks(results, { at, local: t.local }));
	} finally {
		await devtools.close();
		await discard(t, CHECK_WORKSPACE);
		log(`Stopped ${CHECK_WORKSPACE}.`);
	}
}

/** Polls the instance's samples, keeping a copy that outlives the instance. */
function sampling(t: Target, workspace: string) {
	const samples: Sample[] = [];
	let gone = false;
	const poll = async () => {
		try {
			const fresh = await t.json<Sample[]>(`/w/${workspace}/control/samples`);
			const last = samples.at(-1)?.at ?? 0;
			samples.push(...fresh.filter((s) => s.at > last && "memory" in s));
			gone = false;
		} catch (error) {
			gone = true;
			log(`Samples: ${(error as Error).message}`);
		}
	};
	const timer = setInterval(() => void poll(), 15_000);
	return {
		samples,
		get gone() {
			return gone;
		},
		async stop() {
			clearInterval(timer);
			await poll();
		},
	};
}

async function takeover(id: string | undefined) {
	const workflow = trialWorkflow(id, "takeover", Object.keys(workflows));
	const t = await target();
	const at = new Date();
	const opened = await start(t, TAKEOVER);
	const devtools = await serveLoopback({
		workerUrl: t.url,
		workspace: TAKEOVER,
		route: "devtools",
		port: 9222,
		key: t.key,
	});
	const sampler = sampling(t, TAKEOVER);
	const probes: { route: number; reach: { chrome: string; gate: string; lock: string } }[] = [];
	const probe = async () => ({
		route: (await t.raw(`/w/${TAKEOVER}/devtools/json/version`)).status,
		reach: await t.json<{ chrome: string; gate: string; lock: string }>(
			`/w/${TAKEOVER}/control/devtools-reach`,
		),
	});
	let prober: ReturnType<typeof setInterval> | undefined;
	try {
		const entry = await takeOverWorkflow({
			workflow,
			devtools: devtools.url,
			viewUrl: `${t.url}/w/${TAKEOVER}/view/vnc.html?autoconnect=1&resize=scale&path=w/${TAKEOVER}/view/websockify`,
			decisions: decisionsOf(t, TAKEOVER),
			host: "cloudflare-signed-in",
			log,
			lock: {
				async takeOver() {
					await t.call(`/w/${TAKEOVER}/takeover`, "POST");
					log("DevTools locked. The view asks you to sign in with GitHub first.");
					probes.push(await probe());
					prober = setInterval(() => {
						probe().then(
							(p) => probes.push(p),
							(error: Error) => log(`Probe: ${error.message}`),
						);
					}, 20_000);
				},
				async handBack() {
					clearInterval(prober);
					probes.push(await probe());
					const { saved } = await t.json<{ saved: { cookies: number; domains: string[] } }>(
						`/w/${TAKEOVER}/handback`,
						"POST",
					);
					log(
						`DevTools unlocked. Saved ${saved.cookies} cookies from ${saved.domains.length} domains.`,
					);
				},
			},
		});
		const after = await probe();
		await sampler.stop();
		const status = await t.json<Status>(`/w/${TAKEOVER}/status`);
		log(`Paste these entries under ${SLOT}:`);
		process.stdout.write(entry);
		process.stdout.write(lockEntry({ at, probes, after }));
		process.stdout.write(
			memoryEntry({
				workflow: workflow.name,
				instanceType: opened.instanceType ?? "unknown",
				at,
				samples: sampler.samples,
				completed: /· (pass|works with take-over)$/m.test(entry),
				instanceGone: sampler.gone || !status.running,
			}),
		);
		log(
			`Cookies are saved. The instance now stops on its own when idle. On a later date: pnpm feasibility:containers restore ${id}`,
		);
	} finally {
		clearInterval(prober);
		await sampler.stop();
		await devtools.close();
	}
}

async function signedInOn(t: Target, ids: WorkflowId[]) {
	const devtools = await serveLoopback({
		workerUrl: t.url,
		workspace: TAKEOVER,
		route: "devtools",
		port: 9222,
		key: t.key,
	});
	const tab = await Tab.open(devtools.url);
	try {
		const results: { name: string; signedIn: boolean; finishedAt: string }[] = [];
		for (const id of ids) {
			const { name, task } = workflows[id];
			log(`Bot opens ${task.url} without the owner…`);
			await tab.goto(task.url);
			const signedIn = await tab.waitFor(task.done, 15_000);
			results.push({ name, signedIn, finishedAt: await tab.evaluate<string>("location.href") });
		}
		return results;
	} finally {
		tab.close();
		await devtools.close();
	}
}

async function restore(id: string | undefined) {
	const workflow = trialWorkflow(id, "restore", LOGINS);
	const t = await target();
	// A running instance still holds the login on its disk; only a new one proves the restore.
	await discard(t, TAKEOVER);
	const opened = await start(t, TAKEOVER);
	try {
		if (!opened.restoredCookies || !opened.cookiesSavedAt) {
			throw new Error("No stored cookies to restore. Run takeover first.");
		}
		const at = new Date();
		const before = (await decisionsOf(t, TAKEOVER)()).length;
		const [result] = await signedInOn(t, [id as WorkflowId]);
		const denied = [
			...new Set(
				(await decisionsOf(t, TAKEOVER)())
					.slice(before)
					.filter((d) => d.decision === "deny")
					.map((d) => d.host),
			),
		].sort();
		log(`Paste this entry under ${SLOT} > Restored logins on a later date:`);
		process.stdout.write(
			restoreEntry({
				workflow: workflow.name,
				task: workflow.task.describe,
				at,
				savedAt: new Date(opened.cookiesSavedAt),
				restoredCookies: opened.restoredCookies,
				botSignedIn: result?.signedIn ?? false,
				finishedAt: result?.finishedAt ?? "about:blank",
				denied,
			}),
		);
	} finally {
		// Discarding does not save, so a failed restore never replaces the take-over's cookies.
		await discard(t, TAKEOVER);
	}
}

async function forget() {
	const t = await target();
	const at = new Date();
	await t.call(`/w/${TAKEOVER}/cookies`, "DELETE");
	await discard(t, TAKEOVER);
	log("Deleted the stored cookies and destroyed the instance without saving.");
	const opened = await start(t, TAKEOVER);
	try {
		const results = await signedInOn(t, LOGINS);
		log(`Paste this entry under ${SLOT} > Deleting the stored cookies:`);
		process.stdout.write(
			forgetEntry({
				at,
				restoredCookies: opened.restoredCookies,
				signedIn: Object.fromEntries(results.map((r) => [r.name, r.signedIn])),
			}),
		);
	} finally {
		await discard(t, TAKEOVER);
	}
}

async function idle() {
	const t = await target();
	const at = new Date();
	const pollMs = 15_000;
	const heldMs = Number(values["hold-minutes"]) * 60_000;
	const waitMs = Number(values["wait-minutes"]) * 60_000;
	const status = () => t.json<Status>(`/w/${CHECK_WORKSPACE}/status`);
	await discard(t, CHECK_WORKSPACE);
	const opened = await start(t, CHECK_WORKSPACE);
	try {
		await t.call(`/w/${CHECK_WORKSPACE}/hold/task`, "POST");
		log(`Holding for ${values["hold-minutes"]} minutes. Nothing uses the instance meanwhile.`);
		let survivedHold = true;
		for (const began = Date.now(); Date.now() - began < heldMs; await sleep(pollMs)) {
			if (!(await status()).running) {
				survivedHold = false;
				break;
			}
		}
		if (survivedHold) await t.call(`/w/${CHECK_WORKSPACE}/hold/task`, "DELETE");
		log("Released. Nothing uses the instance now; reading only the Durable Object's status…");
		let idleSurvivedMs: number | null = null;
		const released = Date.now();
		while (survivedHold && Date.now() - released < waitMs) {
			await sleep(pollMs);
			const now = await status();
			if (!now.running) {
				idleSurvivedMs = Date.now() - (now.lastActivityAt ?? released);
				break;
			}
		}
		log(`Paste this entry under ${SLOT} > Idle stops:`);
		process.stdout.write(
			idleEntry({
				at,
				instanceType: opened.instanceType,
				heldMs,
				survivedHold,
				idleSurvivedMs,
				waitedMs: Date.now() - released,
				pollMs,
			}),
		);
	} finally {
		await discard(t, CHECK_WORKSPACE);
	}
}

async function screens() {
	const t = await target();
	const at = new Date();
	const max = Number(values.max);
	const url = values.url ?? "https://www.linkedin.com/login";
	await discard(t, TAKEOVER);
	const opened = await start(t, TAKEOVER);
	const steps: { screens: number; alive: boolean; memory: Memory }[] = [];
	try {
		await t.call(`/w/${TAKEOVER}/hold/task`, "POST");
		for (let n = 1; n <= max; n++) {
			log(`Opening screen ${n} beside the main one…`);
			await t.call(`/w/${TAKEOVER}/control/screens?url=${encodeURIComponent(url)}`, "POST");
			await sleep(30_000);
			const memory = await t.json<Memory>(`/w/${TAKEOVER}/control/memory`);
			const list = await t.json<{ alive: boolean }[]>(`/w/${TAKEOVER}/control/screens`);
			const main = await t.raw(`/w/${TAKEOVER}/control/ready`).then(
				(r) => r.ok,
				() => false,
			);
			const alive = main && list.every((screen) => screen.alive);
			steps.push({ screens: n, alive, memory });
			const ceiling = memory.limitMib ?? memory.memTotalMib ?? Infinity;
			if (!alive || memory.currentMib > 0.9 * ceiling) break;
		}
		log(`Paste this entry under ${SLOT} > Screens per instance:`);
		process.stdout.write(capacityEntry({ at, instanceType: opened.instanceType, url, steps }));
	} finally {
		// Discarding, not releasing: a release would save this run's cookies over the take-over's.
		await discard(t, TAKEOVER);
	}
}

/** Two sockets: one pings every 10 s for the hold, one stays silent after opening. */
const longSocketProbe = (holdMs: number) => `(() => {
	const blank = () => ({ opened: false, greeting: null, sent: 0, echoed: 0, openForMs: 0, openAtEnd: false, closeCode: null });
	const out = { active: blank(), idle: blank(), result: null };
	window.__longSocket = out;
	const a = new WebSocket("wss://${LONG_SOCKET_HOST}/");
	const i = new WebSocket("wss://${LONG_SOCKET_HOST}/");
	let aStart = 0, iStart = 0, timer;
	const send = () => { a.send("ping " + out.active.sent); out.active.sent++; };
	a.onmessage = ({ data }) => { if (String(data).startsWith("ping ")) out.active.echoed++; else out.active.greeting ??= "greeting"; };
	a.onclose = (e) => { out.active.closeCode = e.code; out.active.openForMs = Date.now() - aStart; clearInterval(timer); };
	i.onopen = () => { out.idle.opened = true; iStart = Date.now(); };
	i.onclose = (e) => { out.idle.closeCode = e.code; out.idle.openForMs = Date.now() - iStart; };
	a.onopen = () => {
		out.active.opened = true;
		aStart = Date.now();
		send();
		timer = setInterval(send, 10000);
		setTimeout(() => {
			clearInterval(timer);
			setTimeout(() => {
				// A socket that closed early keeps the time its close handler recorded.
				if (a.readyState === WebSocket.OPEN) { out.active.openForMs = Date.now() - aStart; out.active.openAtEnd = true; }
				if (i.readyState === WebSocket.OPEN) { out.idle.openForMs = Date.now() - iStart; out.idle.openAtEnd = true; }
				out.result = JSON.parse(JSON.stringify({ active: out.active, idle: out.idle }));
				a.close();
				i.close();
			}, 3000);
		}, ${holdMs});
	};
	return true;
})()`;

async function socket() {
	const t = await target();
	const at = new Date();
	const holdMs = Number(values.minutes) * 60_000;
	await discard(t, CHECK_WORKSPACE);
	await start(t, CHECK_WORKSPACE);
	const devtools = await serveLoopback({
		workerUrl: t.url,
		workspace: CHECK_WORKSPACE,
		route: "devtools",
		port: 9222,
		key: t.key,
	});
	const tab = await Tab.open(devtools.url);
	try {
		await t.call(`/w/${CHECK_WORKSPACE}/hold/task`, "POST");
		const before = (await decisionsOf(t, CHECK_WORKSPACE)()).length;
		await tab.goto(WEBSOCKET_PAGE);
		await tab.evaluate(longSocketProbe(holdMs));
		log(`Holding two WebSockets for ${values.minutes} minutes…`);
		type Result = { active: WebSocketSession; idle: WebSocketSession };
		let result: Result | null = null;
		while (!result) {
			// Polling keeps the DevTools socket through the Worker busy; a silent one could be cut.
			await sleep(15_000);
			result = await tab.evaluate<Result | null>("window.__longSocket.result");
		}
		const upgradeAllowed = (await decisionsOf(t, CHECK_WORKSPACE)())
			.slice(before)
			.some(
				(d) => d.host === LONG_SOCKET_HOST && d.method === "WEBSOCKET" && d.decision === "allow",
			);
		log(`Paste this entry under ${SLOT} > Long sessions:`);
		process.stdout.write(
			socketEntry({ at, holdMs, farEnd: LONG_SOCKET_HOST, ...result, upgradeAllowed }),
		);
	} finally {
		tab.close();
		await devtools.close();
		await discard(t, CHECK_WORKSPACE);
	}
}

async function stop(workspace = TAKEOVER) {
	const t = await target();
	const { saved } = await t.json<{ saved?: { cookies?: number; error?: string } }>(
		`/w/${workspace}/stop`,
		"POST",
	);
	log(
		`Destroyed the ${workspace} instance. ${saved?.error ? `Cookies not saved: ${saved.error}` : `Saved ${saved?.cookies ?? 0} cookies first.`}`,
	);
}

async function destroy() {
	// The stack declaration still runs on destroy, so it needs values. They never reach Cloudflare.
	const code = await alchemy(STACK, "destroy", {
		TRIAL_RUN_KEY: "unused",
		COOKIE_KEY: "unused",
		OWNER_SESSION_KEY: "unused",
		GITHUB_CLIENT_ID: "unused",
		GITHUB_CLIENT_SECRET: "unused",
		OWNER_GITHUB_ID: "unused",
	});
	const now = new Date().toISOString();
	if (code === 0) {
		for (const file of Object.values(keyFiles)) await rm(file, { force: true });
	}
	log("Paste this entry under the trial's Teardown slot:");
	process.stdout.write(
		[
			"",
			`#### ${now.slice(0, 10)} · Containers trial stage torn down · ${code === 0 ? "pass" : "fail"}`,
			"",
			`- **Date:** ${now.slice(0, 10)}, ${now.slice(11, 16)} UTC`,
			`- **Command:** \`pnpm feasibility:containers destroy\`, \`alchemy destroy --stage ${STACK.stage}\` exited ${code}`,
			`- **Removed:** Worker \`ditto-${STACK.stage}-workspaces\`, its \`Workspace\` Durable Object namespace with the stored cookies, the container application and its image, and the secrets${code === 0 ? ", and the local run, cookie and session keys" : ""}`,
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
else if (name === "idle") await idle();
else if (name === "screens") await screens();
else if (name === "socket") await socket();
else if (name === "stop") await stop(arg);
else if (name === "destroy") await destroy();
else {
	console.error(
		"Usage: pnpm feasibility:containers deploy --spending-cap-set [--instance standard-1] | checks [--ws-hold-ms 65000] | takeover <google|linkedin|protected> | restore <google|linkedin> | forget | idle [--hold-minutes 8] | screens [--max 6] | socket [--minutes 30] | stop [workspace] | destroy",
	);
	process.exit(2);
}
