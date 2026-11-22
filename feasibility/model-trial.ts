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

type Step = { ok: boolean; detail: string };

export interface TrialRun {
	route: TrialRoute;
	model: string;
	startedAt: Date;
	steps: Step[];
	outcome: "pass" | "fail";
	/** Every credential value seen during the run, so the entry can be redacted. */
	secrets: Secret[];
}

export interface TrialInput {
	route: TrialRoute;
	/** Holds the owner's credential: an OAuth credential for `chatgpt`, an API key for `opencode`. */
	credentials: CredentialStore;
	model?: string;
	/** The network. Defaults to the runtime's own fetch; tests pass a simulated provider. */
	fetch?: typeof fetch;
	now?: () => Date;
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
				{ ok: false, detail: `Pi ${PI_AI_VERSION} has no model \`${modelId}\` on this route` },
			]);
		}

		const step = async (label: string, run: () => Promise<Step>): Promise<Step> => {
			const before = calls.length;
			let result: Step;
			try {
				result = await run();
			} catch (error) {
				result = { ok: false, detail: errorText(error) };
			}
			const http = calls.slice(before);
			const where = http.length ? ` (${http.join(", ")})` : "";
			return {
				ok: result.ok,
				detail: `${label} ${result.ok ? "passed" : "failed"}${where}: ${result.detail}`,
			};
		};

		const turn = () => turnStep(models, model, input.route);
		const steps = [await step("turn", turn)];
		if (input.route === "chatgpt") {
			steps.push(
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
				}),
			);
		} else {
			steps.push({
				ok: true,
				detail: "refresh not applicable: an API key has no refresh exchange",
			});
		}
		steps.push(await step("turn after refresh", turn));
		return finish(input.route, modelId, startedAt, secrets, steps);
	} finally {
		globalThis.fetch = original;
	}
}

async function turnStep(
	models: ReturnType<typeof createModels>,
	model: Model<Api>,
	route: TrialRoute,
): Promise<Step> {
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

/** One evidence entry in the format of docs/feasibility/evidence.md, redacted. */
export function formatEvidence(runs: TrialRun[], options: { origin: string }): string {
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
		`- **Runtime:** Pi \`@earendil-works/pi-ai\` ${PI_AI_VERSION}, each step lists every HTTP attempt it made`,
		`- **Date:** ${day(first.startedAt)}, ${clock(first.startedAt)}`,
		`- **Network origin:** ${options.origin}`,
		`- **Expected:** ${expected}`,
		`- **Observed:** ${first.steps.map((s) => s.detail).join(". ")}.${tally}`,
		`- **Retries:** ${retryText}`,
		`- **Fallback:** ${outcome === "pass" ? "none needed" : route.fallback}`,
		"",
	].join("\n");
	return redact(
		entry,
		runs.flatMap((r) => r.secrets),
	);
}
