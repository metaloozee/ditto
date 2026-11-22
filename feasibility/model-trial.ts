// Runtime-agnostic: only Pi and Web APIs, so the same trial runs under Node (#25) and workerd (#26).
import {
	type Api,
	type Credential,
	type CredentialStore,
	createModels,
	type Model,
	PI_AI_VERSION,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";

import { jwtStrings, redact, type Secret } from "./redact.ts";

export type TrialRoute = "chatgpt" | "opencode";

const ROUTES = {
	chatgpt: {
		provider: openaiCodexProvider,
		defaultModel: "gpt-5.6-luna",
		title: "OpenAI Responses on ChatGPT plan",
		endpoint: "https://chatgpt.com/backend-api/codex/responses",
		fallback: "OpenCode API key route (ADR-0003)",
	},
	opencode: {
		provider: opencodeProvider,
		defaultModel: "gpt-5.4-mini",
		title: "OpenAI Responses on OpenCode API key",
		endpoint: "https://opencode.ai/inference/openai/v1/responses",
		fallback: "none available: record the consequence under Unresolved limits",
	},
} as const;

export const defaultModel = (route: TrialRoute) => ROUTES[route].defaultModel;

type Outcome = { ok: boolean; detail: string };

export interface Step extends Outcome {
	label: "turn" | "refresh" | "turn after refresh" | "setup";
	/** CPU the runtime spent on this step, when the driver measured it (#26). */
	cpuMs?: number;
}

export interface TrialRun {
	route: TrialRoute;
	model: string;
	startedAt: Date;
	steps: Step[];
	outcome: "pass" | "fail";
	/** Every credential value seen during the run, so the entry can be redacted. */
	secrets: Secret[];
	/** CPU and wall time of the whole trial request, as Cloudflare reported it (#31). */
	request?: { cpuMs: number; wallMs: number };
}

export interface TrialInput {
	route: TrialRoute;
	/** Holds the owner's credential: an OAuth credential for `chatgpt`, an API key for `opencode`. */
	credentials: CredentialStore;
	model?: string;
	/** The network. Defaults to the runtime's own fetch; tests pass a simulated provider. */
	fetch?: typeof fetch;
	now?: () => Date;
	/** Called after each step, before the next one starts. */
	onStep?: (step: Step) => void | Promise<void>;
}

const PROMPT = "Reply with exactly one word: pong";

/**
 * One inference turn, one token refresh, then one turn on the refreshed token.
 * Pi calls the global fetch for OAuth refresh, so the run swaps it for a
 * recording wrapper and restores it afterwards.
 */
export async function runModelTrial(input: TrialInput): Promise<TrialRun> {
	const route = ROUTES[input.route];
	const now = input.now ?? (() => new Date());
	const network = input.fetch ?? globalThis.fetch;
	const calls: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (request, init) => {
		const url = new URL(request instanceof Request ? request.url : String(request));
		const where = `${url.host}${url.pathname}`;
		try {
			const response = await network(request, init);
			calls.push(`${where} ${response.status}`);
			return response;
		} catch (error) {
			calls.push(`${where} network error`);
			throw error;
		}
	};

	const startedAt = now();
	const secrets: Secret[] = [];
	const remember = (credential: Credential | undefined) => {
		if (credential) secrets.push(...credentialSecrets(credential));
	};

	try {
		const provider = route.provider();
		const models = createModels({
			credentials: input.credentials,
			// No ambient env or files: the trial uses only the credential it was given.
			authContext: { env: async () => undefined, fileExists: async () => false },
		});
		models.setProvider(provider);
		const modelId = input.model ?? route.defaultModel;
		const model = models.getModel(provider.id, modelId);
		remember(await input.credentials.read(provider.id));
		if (!model) {
			return finish(input.route, modelId, startedAt, secrets, [
				{
					label: "setup",
					ok: false,
					detail: `Pi ${PI_AI_VERSION} has no model \`${modelId}\` on this route`,
				},
			]);
		}

		const steps: Step[] = [];
		const record = async (step: Step) => {
			steps.push(step);
			await input.onStep?.(step);
		};
		const step = async (label: Step["label"], run: () => Promise<Outcome>) => {
			const before = calls.length;
			let result: Outcome;
			try {
				result = await run();
			} catch (error) {
				result = { ok: false, detail: errorText(error) };
			}
			const http = calls.slice(before);
			const where = http.length ? ` (${http.join(", ")})` : "";
			await record({
				label,
				ok: result.ok,
				detail: `${label} ${result.ok ? "passed" : "failed"}${where}: ${result.detail}`,
			});
		};

		const turn = () => turnStep(models, model, input.route);
		await step("turn", turn);
		if (input.route === "chatgpt") {
			await step("refresh", async () => {
				const before = await input.credentials.read(provider.id);
				if (before?.type !== "oauth") return { ok: false, detail: "no ChatGPT sign-in stored" };
				// Expire the stored token so Pi takes its real refresh path.
				await input.credentials.modify(provider.id, async () => ({ ...before, expires: 0 }));
				await models.getAuth(provider.id);
				const after = await input.credentials.read(provider.id);
				remember(after);
				if (after?.type !== "oauth" || after.access === before.access) {
					return { ok: false, detail: "Pi kept the old access token" };
				}
				const hours = Math.round((after.expires - Date.now()) / 3_600_000);
				const rotated = after.refresh !== before.refresh ? "a new" : "the same";
				return {
					ok: true,
					detail: `new access token valid for ${hours}h, ${rotated} refresh token`,
				};
			});
		} else {
			await record({
				label: "refresh",
				ok: true,
				detail: "refresh not applicable: an API key has no refresh exchange",
			});
		}
		await step("turn after refresh", turn);
		return finish(input.route, modelId, startedAt, secrets, steps);
	} finally {
		globalThis.fetch = original;
	}
}

async function turnStep(
	models: ReturnType<typeof createModels>,
	model: Model<Api>,
	route: TrialRoute,
): Promise<Outcome> {
	const started = Date.now();
	const reply = await models.complete(
		model,
		{ messages: [{ role: "user", content: PROMPT, timestamp: Date.now() }] },
		// SSE over fetch on both routes: workerd has no outbound WebSocket client Pi can use.
		route === "chatgpt" ? { transport: "sse" } : {},
	);
	if (reply.stopReason === "error" || reply.stopReason === "aborted") {
		return { ok: false, detail: reply.errorMessage ?? reply.stopReason };
	}
	const text = reply.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("")
		.trim();
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	const ok = /pong/i.test(text);
	return {
		ok,
		detail: `${ok ? "replied" : "unexpected reply"} "${text.slice(0, 40)}", ${reply.usage.output} output tokens in ${seconds}s`,
	};
}

function finish(
	route: TrialRoute,
	model: string,
	startedAt: Date,
	secrets: Secret[],
	steps: Step[],
): TrialRun {
	const outcome = steps.every((s) => s.ok) ? "pass" : "fail";
	return { route, model, startedAt, steps, outcome, secrets };
}

function errorText(error: unknown): string {
	const parts: string[] = [];
	for (
		let e: unknown = error;
		e && parts.length < 4;
		e = e instanceof Error ? e.cause : undefined
	) {
		const message = e instanceof Error ? e.message : JSON.stringify(e);
		if (!parts.some((part) => part.includes(message))) parts.push(message);
	}
	return parts.join(": ");
}

function credentialSecrets(credential: Credential): Secret[] {
	if (credential.type === "api_key") {
		return credential.key ? [{ value: credential.key, placeholder: "<api key>" }] : [];
	}
	const found: Secret[] = [
		{ value: credential.access, placeholder: "<access token>" },
		{ value: credential.refresh, placeholder: "<refresh token>" },
	];
	for (const [key, value] of Object.entries(credential)) {
		if (typeof value === "string" && !["type", "access", "refresh"].includes(key)) {
			found.push({ value, placeholder: `<${key}>` });
		}
	}
	for (const claim of jwtStrings(credential.access))
		found.push({ value: claim, placeholder: "<account claim>" });
	return found;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const clock = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;
const failures = (run: TrialRun) =>
	run.steps
		.filter((s) => !s.ok)
		.map((s) => s.detail)
		.join("; ");

const DEPLOYED_FALLBACK =
	"evaluate a supported container route (spec #16): open its follow-up ticket and record the consequence";
const FREE_CPU_MS = 10;
const PAID_CPU_MS = 30_000;
const ms = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)}ms`;

/** Per-step CPU, plus how the worst turn and the worst whole request compare with Workers limits. */
function cpuLine(runs: TrialRun[]): string[] {
	if (runs.some((r) => r.request)) return requestCpuLine(runs);
	if (!runs.some((r) => r.steps.some((s) => s.cpuMs !== undefined))) return [];
	const perRun = runs.map((run) =>
		run.steps
			.map((s) => {
				const skipped = s.label === "refresh" && run.route === "opencode";
				return `${s.label} ${skipped || s.cpuMs === undefined ? "not run" : ms(s.cpuMs)}`;
			})
			.join(", "),
	);
	const turns = runs.flatMap((r) =>
		r.steps.filter((s) => s.label.startsWith("turn")).map((s) => s.cpuMs ?? 0),
	);
	const requests = runs.map((r) => r.steps.reduce((sum, s) => sum + (s.cpuMs ?? 0), 0));
	const worstTurn = Math.max(...turns);
	const worstRequest = Math.max(...requests);
	const fits = (value: number, limit: number) => (value <= limit ? "within" : "over");
	const runsText =
		perRun.length > 1 ? perRun.map((r, i) => `run ${i + 1}: ${r}`).join("; ") : perRun[0];
	return [
		`- **CPU time:** ${runsText}. Worst turn ${ms(worstTurn)}, worst whole trial request ${ms(worstRequest)}: ${fits(worstRequest, FREE_CPU_MS)} the Workers free plan (10ms per request), ${fits(worstRequest, PAID_CPU_MS)} the paid plan default (30s per request, configurable to 5 min). Measured as workerd process CPU, so an upper bound.`,
	];
}

/** A deployed Worker reports CPU per request, not per step: one figure per trial. */
function requestCpuLine(runs: TrialRun[]): string[] {
	const perRun = runs.map((r) =>
		r.request
			? `whole trial request ${ms(r.request.cpuMs)} CPU, ${ms(r.request.wallMs)} wall`
			: "not reported",
	);
	const worst = Math.max(...runs.map((r) => r.request?.cpuMs ?? 0));
	const fits = (limit: number) => (worst <= limit ? "within" : "over");
	const runsText =
		perRun.length > 1 ? perRun.map((r, i) => `run ${i + 1}: ${r}`).join("; ") : perRun[0];
	return [
		`- **CPU time:** ${runsText}, from the Worker's tail event. Worst ${ms(worst)}: ${fits(FREE_CPU_MS)} the Workers free plan (10ms per request), ${fits(PAID_CPU_MS)} the paid plan default (30s per request, configurable to 5 min).`,
	];
}

/** One evidence entry in the format of docs/feasibility/evidence.md, redacted. */
export function formatEvidence(
	runs: TrialRun[],
	options: {
		origin: string;
		/** Where Pi ran, when not Node. */
		runtime?: string;
		/** Ran in a deployed Worker, where a failure points at a container route instead (#31). */
		deployed?: boolean;
	},
): string {
	const [first, ...retries] = runs;
	if (!first) throw new Error("formatEvidence needs at least one run");
	const route = ROUTES[first.route];
	const outcome = runs.every((r) => r.outcome === "pass") ? "pass" : "fail";
	const refresh =
		first.route === "chatgpt"
			? "expire the stored access token and refresh it at https://auth.openai.com/oauth/token"
			: "skip refresh (an API key has none)";
	const expected =
		first.route === "chatgpt"
			? 'both turns return 200 and reply "pong". The refresh returns 200 with a new access token, and the second turn succeeds on it.'
			: 'both turns return 200 and reply "pong".';
	const passed = runs.filter((r) => r.outcome === "pass").length;
	const tally = runs.length > 1 ? ` ${passed} of ${runs.length} runs passed.` : "";
	const retryText = retries.length
		? retries
				.map(
					(r) =>
						`${clock(r.startedAt)} ${r.outcome}${r.outcome === "fail" ? ` (${failures(r)})` : ""}`,
				)
				.join(", ")
		: "none";

	const entry = [
		`#### ${day(first.startedAt)} · ${route.title} from ${options.origin} · ${outcome}`,
		"",
		`- **Route:** Pi \`${first.route === "chatgpt" ? "openai-codex" : "opencode"}\` provider, model \`${first.model}\`: one turn at ${route.endpoint}, ${refresh}, then one more turn`,
		`- **Runtime:** Pi \`@earendil-works/pi-ai\` ${PI_AI_VERSION}${options.runtime ? ` in ${options.runtime}` : ""}, each step lists every HTTP attempt it made`,
		`- **Date:** ${day(first.startedAt)}, ${clock(first.startedAt)}`,
		`- **Network origin:** ${options.origin}`,
		`- **Expected:** ${expected}`,
		`- **Observed:** ${first.steps.map((s) => s.detail).join(". ")}.${tally}`,
		`- **Retries:** ${retryText}`,
		`- **Fallback:** ${outcome === "pass" ? "none needed" : options.deployed ? DEPLOYED_FALLBACK : route.fallback}`,
		...cpuLine(runs),
		"",
	].join("\n");
	return redact(
		entry,
		runs.flatMap((r) => r.secrets),
	);
}
