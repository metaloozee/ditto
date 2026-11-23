// Owner commands for Chrome and the egress filter on Cloudflare Containers (#32). Live: they deploy
// to the owner's Cloudflare account, which must be on Workers Paid, and run billed instances.
//   pnpm feasibility:containers deploy --spending-cap-set [--instance standard-1]
//   pnpm feasibility:containers checks [--ws-hold-ms 65000]   allow, deny, fence, WebSocket, HTTP/2
//   pnpm feasibility:containers takeover <google|linkedin|protected>
//   pnpm feasibility:containers stop [ws-cloud-trial|ws-takeover]
//   pnpm feasibility:containers destroy
// Progress goes to stderr. Evidence entries go to stdout. `--worker-url` points the commands at
// another stage, such as `alchemy dev`, with its run key in TRIAL_RUN_KEY.
import { rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
	alchemy,
	configDir,
	deployedUrl,
	runKey,
	savedRunKey,
	type Stack,
} from "../owner-stage.ts";
import { takeOverWorkflow } from "../takeover/flow.ts";
import { workflows, type WorkflowId } from "../takeover/workflows.ts";
import { CHECK_WORKSPACE, type Decision, renderChecks, runChecks, type Started } from "./checks.ts";
import { serveLoopback } from "./loopback.ts";

const STACK: Stack = {
	dir: import.meta.dirname,
	name: "ditto-containers-trial",
	stage: "containers-trial",
};
const runKeyFile = path.join(configDir, "containers-run-key");
const INSTANCE_TYPES = ["lite", "basic", "standard-1", "standard-2", "standard-3", "standard-4"];

const log = (message: string) => console.error(`[containers] ${message}`);

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		"worker-url": { type: "string" },
		"spending-cap-set": { type: "boolean", default: false },
		instance: { type: "string", default: "standard-1" },
		"ws-hold-ms": { type: "string", default: "65000" },
	},
});

async function target() {
	const url = values["worker-url"] ?? (await deployedUrl(STACK));
	if (!url)
		throw new Error("The Containers stage isn't deployed. Run: pnpm feasibility:containers deploy");
	const key =
		process.env.TRIAL_RUN_KEY ??
		(await savedRunKey(runKeyFile, "pnpm feasibility:containers deploy"));
	const local = ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
	const call = async (pathname: string, method = "GET") => {
		const response = await fetch(new URL(pathname, url), {
			method,
			headers: { "x-trial-key": key },
		});
		if (!response.ok)
			throw new Error(`${method} ${pathname}: ${response.status} ${await response.text()}`);
		return response;
	};
	return { url, key, local, call };
}

type Target = Awaited<ReturnType<typeof target>>;

const decisionsOf = (t: Target, workspace: string) => async () =>
	(await (await t.call(`/w/${workspace}/control/decisions`)).text())
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as Decision);

async function start(t: Target, workspace: string): Promise<Started> {
	log(`Starting ${workspace}. A cold start can include pulling the image…`);
	const started = (await (await t.call(`/w/${workspace}/start`, "POST")).json()) as Started;
	log(`Ready in ${started.startupMs} ms on ${started.instanceType}.`);
	return started;
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
	const instance = values.instance ?? "standard-1";
	if (!INSTANCE_TYPES.includes(instance))
		throw new Error(`--instance must be one of ${INSTANCE_TYPES.join(", ")}`);
	log(
		`Deploying to your Cloudflare account with ${instance} instances, at most 2, each destroyed after 60 minutes.`,
	);
	const code = await alchemy(STACK, "deploy", {
		TRIAL_RUN_KEY: await runKey(runKeyFile),
		INSTANCE_TYPE: instance,
	});
	if (code !== 0) process.exit(code);
	log("Deployed. Run the checks with: pnpm feasibility:containers checks");
}

async function checks() {
	const t = await target();
	// Always a cold start, so the startup time is comparable between runs.
	await t.call(`/w/${CHECK_WORKSPACE}/stop`, "POST");
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
		await t.call(`/w/${CHECK_WORKSPACE}/stop`, "POST");
		log(`Stopped ${CHECK_WORKSPACE}.`);
	}
}

async function takeover(id: string | undefined) {
	if (!id || !(id in workflows)) {
		console.error(
			`Usage: pnpm feasibility:containers takeover <${Object.keys(workflows).join("|")}>`,
		);
		process.exit(2);
	}
	const workflow = workflows[id as WorkflowId];
	const t = await target();
	await start(t, "ws-takeover");
	const doorway = { workerUrl: t.url, workspace: "ws-takeover", key: t.key } as const;
	const devtools = await serveLoopback({ ...doorway, route: "devtools", port: 9222 });
	const view = await serveLoopback({ ...doorway, route: "view", port: 6080 });
	// Cloudflare stops an instance after 3 to 5 idle minutes despite setInactivityTimeout, and the
	// view's WebSocket does not count as activity, so a slow sign-in would lose the instance.
	const keepAlive = setInterval(() => {
		t.call("/w/ws-takeover/control/ready").catch((error: Error) =>
			log(`Keep-alive: ${error.message}`),
		);
	}, 30_000);
	try {
		const entry = await takeOverWorkflow({
			workflow,
			devtools: devtools.url,
			viewUrl: `${view.url}/vnc.html?autoconnect=1&resize=scale`,
			decisions: decisionsOf(t, "ws-takeover"),
			host: "cloudflare",
			log,
		});
		log(
			`Paste this entry under Desktop provider > Cloudflare Containers trial (#32) > ${workflow.name}:`,
		);
		process.stdout.write(entry);
		log(
			"The signed-in instance keeps running for the next workflow. After the last one: pnpm feasibility:containers stop ws-takeover",
		);
	} finally {
		clearInterval(keepAlive);
		await devtools.close();
		await view.close();
	}
}

async function stop(workspace = "ws-takeover") {
	const t = await target();
	await t.call(`/w/${workspace}/stop`, "POST");
	log(`Destroyed the ${workspace} instance and anything signed in on it.`);
}

async function destroy() {
	// The stack declaration still runs on destroy, so it needs a value. It never reaches Cloudflare.
	const code = await alchemy(STACK, "destroy", { TRIAL_RUN_KEY: "unused" });
	const now = new Date().toISOString();
	if (code === 0) await rm(runKeyFile, { force: true });
	log("Paste this entry under Desktop provider > Cloudflare Containers trial (#32) > Teardown:");
	process.stdout.write(
		[
			"",
			`#### ${now.slice(0, 10)} · Containers trial stage torn down · ${code === 0 ? "pass" : "fail"}`,
			"",
			`- **Date:** ${now.slice(0, 10)}, ${now.slice(11, 16)} UTC`,
			`- **Command:** \`pnpm feasibility:containers destroy\`, \`alchemy destroy --stage ${STACK.stage}\` exited ${code}`,
			`- **Removed:** Worker \`ditto-${STACK.stage}-workspaces\`, its \`Workspace\` Durable Object namespace, the container application and its image, and the run-key secret${code === 0 ? ", and the local run key" : ""}`,
			"",
		].join("\n"),
	);
	if (code !== 0) process.exit(code);
}

const [name, arg] = positionals;
if (name === "deploy") await deploy();
else if (name === "checks") await checks();
else if (name === "takeover") await takeover(arg);
else if (name === "stop") await stop(arg);
else if (name === "destroy") await destroy();
else {
	console.error(
		"Usage: pnpm feasibility:containers deploy --spending-cap-set [--instance standard-1] | checks [--ws-hold-ms 65000] | takeover <google|linkedin|protected> | stop [workspace] | destroy",
	);
	process.exit(2);
}
