// Runtime-agnostic: only Pi and Web APIs, so the same trial runs under Node (#25) and workerd (#26).
import {
	type Api,
	type Credential,
	type CredentialStore,
	createModels,
	type Model,
	PI_AI_VERSION,
} from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";

import { jwtStrings, redact, type Secret } from "./redact.ts";

/**
 * `chatgpt` is the Codex backend Pi's `openai-codex` provider calls (#25, #26, #30, #31).
 * `siwc` is the supported plan-usage route: Sign in with ChatGPT tokens on api.openai.com (#34).
 */
export type TrialRoute = "chatgpt" | "siwc" | "opencode";

const ROUTES = {
	chatgpt: {
		provider: openaiCodexProvider,
		defaultModel: "gpt-5.6-luna",
		title: "OpenAI Responses on ChatGPT plan",
		endpoint: "https://chatgpt.com/backend-api/codex/responses",
		fallback: "OpenCode API key route (ADR-0003)",
	},
	siwc: {
		provider: openaiProvider,
		defaultModel: "gpt-5.6-luna",
		title: "OpenAI Responses on ChatGPT plan through Sign in with ChatGPT",
		endpoint: "https://api.openai.com/v1/responses",
		fallback:
			"OpenCode API key route (ADR-0003); the ChatGPT plan stays local-only for self-deployed Ditto",
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
	/** CPU the runtime spent on this step, when the driver measured it. */
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
	/** CPU and wall time of the whole trial request, as Cloudflare reported it. */
	request?: { cpuMs: number; wallMs: number; from?: "Worker" | "Durable Object" };
	/** Top-level body fields and input roles Pi sent to api.openai.com (`siwc` only). */
	sent?: { fields: string[]; roles: string[] };
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
	const sentFields = new Set<string>();
	const sentRoles = new Set<string>();
	const tokenResponses: Record<string, unknown>[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (request, init) => {
		const url = new URL(request instanceof Request ? request.url : String(request));
		const where = `${url.host}${url.pathname}`;
		if (`https://${where}` === ROUTES.siwc.endpoint) {
			const body = await requestBody(request, init);
			for (const field of Object.keys(body)) sentFields.add(field);
			if (Array.isArray(body.input)) {
				for (const item of body.input as { role?: unknown }[]) {
					if (typeof item.role === "string") sentRoles.add(item.role);
				}
			}
		}
		try {
			const response = await network(request, init);
			calls.push(`${where} ${response.status}`);
			if (url.pathname.endsWith("/oauth/token") && response.ok) {
				tokenResponses.push(
					await response
						.clone()
						.json()
						.catch(() => ({})),
				);
			}
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
			result.detail = pageText(result.detail);
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
		if (input.route !== "opencode") {
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
				const rotated = after.refresh !== before.refresh ? "a new" : "the same";
				const token = tokenResponses.at(-1);
				if (input.route === "siwc" && token) {
					const seconds = Number(token.expires_in);
					return {
						ok: true,
						detail: `expires_in ${seconds}s (${Math.round(seconds / 3600)}h), granted scope \`${String(token.scope)}\`, ${rotated} refresh token`,
					};
				}
				const hours = Math.round((after.expires - Date.now()) / 3_600_000);
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
		const run = finish(input.route, modelId, startedAt, secrets, steps);
		if (input.route === "siwc") run.sent = { fields: [...sentFields], roles: [...sentRoles] };
		return run;
	} finally {
		globalThis.fetch = original;
	}
}

async function requestBody(
	request: RequestInfo | URL,
	init: RequestInit | undefined,
): Promise<Record<string, unknown>> {
	try {
		const text =
			request instanceof Request
				? await request.clone().text()
				: typeof init?.body === "string"
					? init.body
					: "";
		const body: unknown = JSON.parse(text);
		return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
	} catch {
		return {};
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

/** An HTML error page reduced to its visible text, so a block page stays a line, not 30KB. */
function pageText(detail: string): string {
	return detail.replace(/<html[\s\S]*?(<\/html>|$)/gi, (page) =>
		page
			.replace(/<(style|script|svg)[\s\S]*?<\/\1>/gi, " ")
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
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
	const from = runs.find((r) => r.request)?.request?.from ?? "Worker";
	const fits = (limit: number) => (worst <= limit ? "within" : "over");
	const runsText =
		perRun.length > 1 ? perRun.map((r, i) => `run ${i + 1}: ${r}`).join("; ") : perRun[0];
	return [
		`- **CPU time:** ${runsText}, from the ${from}'s tail event. Worst ${ms(worst)}: ${fits(FREE_CPU_MS)} the Workers free plan (10ms per request), ${fits(PAID_CPU_MS)} the paid plan default (30s per request, configurable to 5 min).`,
	];
}

/** What a fresh Sign in with ChatGPT observed, for the evidence entry (#34). */
export interface SiwcSignIn {
	/** The issued client ID, redacted in the entry. */
	clientId: string;
	grantedScopes: string[];
	/** Access-token lifetime in seconds, from the token response. */
	expiresIn: number;
	/** Refresh-token lifetime in seconds, when the token response states one. */
	refreshExpiresIn?: number;
	/** ID-token lifetime in seconds, `exp` minus `iat`. */
	idTokenSeconds?: number;
	/** Field names in the token response, values left out. */
	tokenFields: string[];
	idToken: { ok: boolean; failures: string[] };
}

/** The sign-in line of an evidence entry. The caller redacts the client ID. */
export function formatSignIn(signIn: SiwcSignIn): string {
	const checks = signIn.idToken.ok ? "pass" : `fail (${signIn.idToken.failures.join(", ")})`;
	return `- **Sign-in:** authorization code with PKCE on the 127.0.0.1:1455 loopback, a \`urn:uuid\` host ID, issued client \`${signIn.clientId}\`. Granted scope \`${signIn.grantedScopes.join(" ")}\`, access token expires_in ${signIn.expiresIn}s, refresh token lifetime ${signIn.refreshExpiresIn === undefined ? "not in the token response" : `${signIn.refreshExpiresIn}s`}, ID token valid ${signIn.idTokenSeconds === undefined ? "for an unstated time" : `${signIn.idTokenSeconds}s`}. ID token signature, iss, aud, exp and nonce checked: ${checks}. Token response fields: ${signIn.tokenFields.map((f) => `\`${f}\``).join(", ")}.`;
}

/** Pi's provider id for each route. */
export const PI_PROVIDER = {
	chatgpt: "openai-codex",
	siwc: "openai",
	opencode: "opencode",
} as const;

/** Request fields OpenAI's plan-usage docs say the flow rejects. */
export const REJECTED_FIELDS = [
	"temperature",
	"max_output_tokens",
	"previous_response_id",
	"prompt",
];
/** OpenAI's plan-usage error codes, which entries record and redaction keeps. */
export const PLAN_USAGE_ERROR = /\b(?:subscription_sharing|chatpass_v2)_[a-z_]+/g;

/** What Pi sent across every run, checked against the fields the plan-usage flow rejects, and every plan-usage error code seen. */
function siwcLines(runs: TrialRun[]): string[] {
	const fields = [...new Set(runs.flatMap((r) => r.sent?.fields ?? []))];
	const roles = [...new Set(runs.flatMap((r) => r.sent?.roles ?? []))];
	const rejected = [
		...fields.filter((f) => REJECTED_FIELDS.includes(f)).map((f) => `\`${f}\``),
		...roles.filter((r) => r === "system").map(() => "system-role items"),
	];
	const untested = roles.some((r) => r === "system" || r === "developer")
		? ""
		: " The trial sends no system prompt, so system-role items are not exercised.";
	const verdict = rejected.length
		? `Fields the flow rejects that Pi sent: ${rejected.join(", ")}.`
		: `None of the fields the flow rejects (${REJECTED_FIELDS.map((f) => `\`${f}\``).join(", ")}, system-role items).${untested}`;
	const sent = fields.length
		? `Pi sent ${fields.map((f) => `\`${f}\``).join(", ")}; input roles ${roles.map((r) => `\`${r}\``).join(", ") || "none"}. ${verdict}`
		: "no request reached api.openai.com/v1/responses";
	const codes = [
		...new Set(
			runs.flatMap((r) =>
				r.steps.flatMap(
					(s) => s.detail.match(/\b(subscription_sharing|chatpass_v2)_[a-z_]+/g) ?? [],
				),
			),
		),
	];
	return [
		`- **Request fields:** ${sent}`,
		`- **Plan-usage error codes:** ${codes.length ? codes.map((c) => `\`${c}\``).join(", ") : "none"}`,
	];
}

/** One evidence entry in the format of docs/feasibility/evidence.md, redacted. */
export function formatEvidence(
	runs: TrialRun[],
	options: {
		origin: string;
		/** Where Pi ran, when not Node. */
		runtime?: string;
		/** Ran in a deployed Worker, where a failure points at a container route instead. */
		deployed?: boolean;
		/** A Sign in with ChatGPT made for this entry. */
		signIn?: SiwcSignIn;
	},
): string {
	const [first, ...retries] = runs;
	if (!first) throw new Error("formatEvidence needs at least one run");
	const route = ROUTES[first.route];
	const outcome = runs.every((r) => r.outcome === "pass") ? "pass" : "fail";
	const refresh = {
		chatgpt: "expire the stored access token and refresh it at https://auth.openai.com/oauth/token",
		siwc: "expire the stored access token and refresh it at https://auth.openai.com/api/accounts/oauth/token",
		opencode: "skip refresh (an API key has none)",
	}[first.route];
	const expected =
		first.route !== "opencode"
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
		`- **Route:** Pi \`${PI_PROVIDER[first.route]}\` provider, model \`${first.model}\`: one turn at ${route.endpoint}, ${refresh}, then one more turn`,
		`- **Runtime:** Pi \`@earendil-works/pi-ai\` ${PI_AI_VERSION}${options.runtime ? ` in ${options.runtime}` : ""}, each step lists every HTTP attempt it made`,
		`- **Date:** ${day(first.startedAt)}, ${clock(first.startedAt)}`,
		`- **Network origin:** ${options.origin}`,
		`- **Expected:** ${expected}`,
		`- **Observed:** ${first.steps.map((s) => s.detail).join(". ")}.${tally}`,
		`- **Retries:** ${retryText}`,
		...(options.signIn ? [formatSignIn(options.signIn)] : []),
		...(first.route === "siwc" ? siwcLines(runs) : []),
		`- **Fallback:** ${outcome === "pass" ? "none needed" : options.deployed && first.route === "chatgpt" ? DEPLOYED_FALLBACK : route.fallback}`,
		...cpuLine(runs),
		"",
	].join("\n");
	const clientId = options.signIn?.clientId;
	return redact(entry, [
		...runs.flatMap((r) => r.secrets),
		...(clientId ? [{ value: clientId, placeholder: "<clientId>" }] : []),
	]);
}
