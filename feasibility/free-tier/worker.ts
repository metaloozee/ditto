// Bare free-tier probe (#30): plain fetch, no Pi runtime, so it stays inside the free-tier CPU limit.
// It answers one question: does OpenAI accept a refresh and an inference request from Cloudflare's network?
import { jwtStrings, redact, type Secret } from "../redact.ts";
import { coloOf, requireRunKey } from "../run-key.ts";

const TOKEN_URL = "https://auth.openai.com/oauth/token";
const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
// The public Codex CLI client id, the same one Pi's openai-codex sign-in uses.
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CREDENTIAL_KEY = "openai-codex";
const PROMPT = "Reply with exactly one word: pong";

export interface ProbeEnv {
	/** Sent by the owner's run command in the `x-trial-key` header, so nobody else spends their plan. */
	TRIAL_RUN_KEY: string;
	PROBE_MODEL: string;
	/** The deploy-time sign-in. Used until the first refresh stores a rotated pair in STORE. */
	CHATGPT_ACCESS_TOKEN: string;
	CHATGPT_REFRESH_TOKEN: string;
	STORE: {
		get(key: string): Promise<string | null>;
		put(key: string, value: string): Promise<void>;
	};
}

type Credential = { access: string; refresh: string };
type Step = { ok: boolean; detail: string };

/** What the Worker returns: already redacted, so it is safe to print. */
export interface ProbeRun {
	startedAt: string;
	model: string;
	/** The Cloudflare data centre that ran the probe. */
	colo: string;
	steps: Step[];
	outcome: "pass" | "fail";
}

export async function handleProbe(
	request: Request,
	env: ProbeEnv,
	network: typeof fetch,
): Promise<Response> {
	const url = new URL(request.url);
	if (request.method !== "POST" || url.pathname !== "/run") {
		return new Response("Not found", { status: 404 });
	}
	const refused = await requireRunKey(request, env.TRIAL_RUN_KEY);
	if (refused) return refused;

	const startedAt = new Date().toISOString();
	const stored = await env.STORE.get(CREDENTIAL_KEY);
	const before: Credential = stored
		? (JSON.parse(stored) as Credential)
		: { access: env.CHATGPT_ACCESS_TOKEN, refresh: env.CHATGPT_REFRESH_TOKEN };
	const secrets: Secret[] = [
		...tokenSecrets(before),
		{ value: env.TRIAL_RUN_KEY, placeholder: "<run key>" },
	];

	// The baseline's sequence: a turn on the token the Worker holds, a refresh, a turn on the new one.
	const first = await step("inference", RESPONSES_URL, () =>
		inferenceStep(before, env.PROBE_MODEL, network),
	);
	const refresh = await step("refresh", TOKEN_URL, () => refreshStep(before, env, network));
	const credential = refresh.credential ?? before;
	if (refresh.credential) secrets.push(...tokenSecrets(refresh.credential));
	const second = await step("inference after refresh", RESPONSES_URL, () =>
		inferenceStep(credential, env.PROBE_MODEL, network),
	);

	const steps = [first.step, refresh.step, second.step].map((s) => ({
		...s,
		detail: redact(s.detail, secrets),
	}));
	const run: ProbeRun = {
		startedAt,
		model: env.PROBE_MODEL,
		colo: coloOf(request),
		steps,
		outcome: steps.every((s) => s.ok) ? "pass" : "fail",
	};
	return Response.json(run);
}

type Attempt<T> = { status: number | "network error"; ok: boolean; detail: string; credential?: T };

async function step<T>(label: string, target: string, run: () => Promise<Attempt<T>>) {
	const where = new URL(target);
	let attempt: Attempt<T>;
	try {
		attempt = await run();
	} catch (error) {
		attempt = {
			status: "network error",
			ok: false,
			detail: error instanceof Error ? error.message : String(error),
		};
	}
	return {
		credential: attempt.credential,
		step: {
			ok: attempt.ok,
			detail: `${label} ${attempt.ok ? "passed" : "failed"} (${where.host}${where.pathname} ${attempt.status}): ${attempt.detail}`,
		},
	};
}

async function refreshStep(
	before: Credential,
	env: ProbeEnv,
	network: typeof fetch,
): Promise<Attempt<Credential>> {
	const response = await network(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: before.refresh,
			client_id: CLIENT_ID,
		}),
	});
	const text = await response.text();
	if (!response.ok) return { status: response.status, ok: false, detail: text.slice(0, 300) };
	const json = JSON.parse(text) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};
	if (!json.access_token)
		return { status: response.status, ok: false, detail: "no access token in the reply" };
	const after = { access: json.access_token, refresh: json.refresh_token ?? before.refresh };
	// Refresh tokens rotate: keep the new pair, or the next day's run refreshes a retired token.
	await env.STORE.put(CREDENTIAL_KEY, JSON.stringify(after));
	const hours = Math.round((json.expires_in ?? 0) / 3600);
	const rotated = after.refresh !== before.refresh ? "a new" : "the same";
	return {
		status: response.status,
		ok: true,
		detail: `new access token valid for ${hours}h, ${rotated} refresh token`,
		credential: after,
	};
}

async function inferenceStep(
	credential: Credential,
	model: string,
	network: typeof fetch,
): Promise<Attempt<never>> {
	const started = Date.now();
	const response = await network(RESPONSES_URL, {
		method: "POST",
		headers: {
			authorization: `Bearer ${credential.access}`,
			"chatgpt-account-id": accountId(credential.access),
			originator: "pi",
			"OpenAI-Beta": "responses=experimental",
			accept: "text/event-stream",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model,
			store: false,
			stream: true,
			input: [{ role: "user", content: [{ type: "input_text", text: PROMPT }] }],
			text: { verbosity: "low" },
		}),
	});
	const text = await response.text();
	if (!response.ok) return { status: response.status, ok: false, detail: text.slice(0, 300) };

	let reply = "";
	let outputTokens: number | undefined;
	for (const line of text.split("\n")) {
		if (!line.startsWith("data:")) continue;
		const event = JSON.parse(line.slice(5)) as {
			type?: string;
			delta?: string;
			response?: { usage?: { output_tokens?: number } };
		};
		if (event.type === "response.output_text.delta") reply += event.delta ?? "";
		if (event.type === "response.completed") outputTokens = event.response?.usage?.output_tokens;
	}
	reply = reply.trim();
	const ok = /pong/i.test(reply);
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	return {
		status: response.status,
		ok,
		detail: `${ok ? "replied" : "unexpected reply"} "${reply.slice(0, 40)}", ${outputTokens ?? "unknown"} output tokens in ${seconds}s`,
	};
}

function accountId(access: string): string {
	try {
		const payload = JSON.parse(
			atob(access.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? ""),
		) as {
			"https://api.openai.com/auth"?: { chatgpt_account_id?: string };
		};
		return payload["https://api.openai.com/auth"]?.chatgpt_account_id ?? "";
	} catch {
		return "";
	}
}

function tokenSecrets(credential: Credential): Secret[] {
	return [
		{ value: credential.access, placeholder: "<access token>" },
		{ value: credential.refresh, placeholder: "<refresh token>" },
		...jwtStrings(credential.access).map((value) => ({ value, placeholder: "<account claim>" })),
	];
}

/**
 * One evidence entry in the format of docs/feasibility/evidence.md. The first run is observed in
 * full; later runs of the same session are its retries.
 */
export function formatProbeEvidence(runs: ProbeRun[]): string {
	const [run, ...retries] = runs;
	if (!run) throw new Error("formatProbeEvidence needs at least one run");
	const day = run.startedAt.slice(0, 10);
	const clock = (r: ProbeRun) => `${r.startedAt.slice(11, 16)} UTC`;
	const outcome = runs.every((r) => r.outcome === "pass") ? "pass" : "fail";
	const origin = `deployed Worker (Cloudflare network, free tier, data centre ${run.colo})`;
	const passed = runs.filter((r) => r.outcome === "pass").length;
	const tally = runs.length > 1 ? ` ${passed} of ${runs.length} runs passed.` : "";
	const failures = (r: ProbeRun) =>
		r.steps
			.filter((s) => !s.ok)
			.map((s) => s.detail)
			.join("; ");
	const retryText = retries.length
		? retries
				.map((r) => `${clock(r)} ${r.outcome}${r.outcome === "fail" ? ` (${failures(r)})` : ""}`)
				.join(", ")
		: "none";
	const entry = [
		`#### ${day} · OpenAI Responses on ChatGPT plan from ${origin} · ${outcome}`,
		"",
		`- **Route:** bare Worker with plain \`fetch\`: one Responses request at ${RESPONSES_URL} on the token the Worker holds, one token refresh at ${TOKEN_URL}, then one more Responses request on the new token, model \`${run.model}\``,
		"- **Runtime:** none: no Pi runtime, so the free-tier CPU limit applies to plain `fetch` only",
		`- **Date:** ${day}, ${clock(run)}`,
		`- **Network origin:** ${origin}`,
		'- **Expected:** both Responses requests return 200 and reply "pong". The refresh returns 200 with a new access token, and the second request succeeds on it.',
		`- **Observed:** ${run.steps.map((s) => s.detail).join(". ")}.${tally}`,
		`- **Retries:** ${retryText}`,
		`- **Fallback:** ${outcome === "pass" ? "none needed" : "evaluate a supported container route (spec #16)"}`,
		"",
	].join("\n");
	// The Worker redacted its own secrets. This catches any token shape it never saw.
	return redact(entry, []);
}

export default {
	fetch(request: Request, env: ProbeEnv): Promise<Response> {
		return handleProbe(request, env, fetch);
	},
};
