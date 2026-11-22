import { describe, expect, it } from "vite-plus/test";

import {
	formatProbeEvidence,
	handleProbe,
	type ProbeEnv,
	type ProbeRun,
} from "./free-tier/worker.ts";

const ACCOUNT_ID = "9f1c2a7e-4b3d-4c55-8e21-0a6b7c8d9e10";
const EMAIL = "owner@example.org";
const RUN_KEY = "run-key-SIMULATED-0123456789abcdefghijklmnop";

function jwt(claims: Record<string, unknown>) {
	const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
	return `${encode({ alg: "none" })}.${encode(claims)}.c2lnbmF0dXJl`;
}

const accessToken = (generation: number) =>
	jwt({
		email: EMAIL,
		"https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT_ID },
		gen: generation,
	});
const refreshToken = (generation: number) => `rt_SIMULATED_${generation}_${"x".repeat(48)}`;

const allSecrets = [
	...[1, 2, 3].flatMap((g) => [accessToken(g), refreshToken(g)]),
	ACCOUNT_ID,
	EMAIL,
	RUN_KEY,
	"SIMULATED",
];

function expectNoSecrets(text: string) {
	for (const secret of allSecrets) expect(text).not.toContain(secret);
}

function sse(text: string) {
	const events = [
		{ type: "response.created", response: { id: "resp_sim" } },
		{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
		{
			type: "response.completed",
			response: { id: "resp_sim", status: "completed", usage: { output_tokens: 2 } },
		},
	];
	const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

type Fault = { status: number; body: string };

/**
 * Simulates auth.openai.com and the ChatGPT Codex Responses endpoint. A refresh
 * rotates both tokens and retires the old ones, so a second run only passes if
 * the Worker kept the rotated refresh token.
 */
function simulatedProvider(faults: { refresh?: Fault; responses?: Fault } = {}) {
	let generation = 1;
	const hosts: string[] = [];
	const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		hosts.push(`${url.host}${url.pathname}`);
		if (url.href === "https://auth.openai.com/oauth/token") {
			if (faults.refresh)
				return new Response(faults.refresh.body, { status: faults.refresh.status });
			const form = new URLSearchParams(await request.text());
			if (form.get("grant_type") !== "refresh_token" || !form.get("client_id")) {
				return new Response('{"error":"invalid_request"}', { status: 400 });
			}
			if (form.get("refresh_token") !== refreshToken(generation)) {
				return new Response('{"error":"invalid_grant"}', { status: 400 });
			}
			generation += 1;
			return Response.json({
				access_token: accessToken(generation),
				refresh_token: refreshToken(generation),
				expires_in: 864_000,
			});
		}
		if (url.href === "https://chatgpt.com/backend-api/codex/responses") {
			if (faults.responses) {
				return new Response(faults.responses.body, { status: faults.responses.status });
			}
			if (request.headers.get("authorization") !== `Bearer ${accessToken(generation)}`) {
				return new Response('{"error":"unauthorized"}', { status: 401 });
			}
			if (request.headers.get("chatgpt-account-id") !== ACCOUNT_ID) {
				return new Response('{"error":"missing account"}', { status: 401 });
			}
			const body = (await request.json()) as { model?: string; stream?: boolean };
			if (body.model !== "gpt-5.6-luna" || body.stream !== true) {
				return new Response('{"error":"bad body"}', { status: 400 });
			}
			return sse("pong");
		}
		return new Response("unexpected host", { status: 599 });
	};
	return { fetch, hosts, generation: () => generation };
}

function memoryKv() {
	const data = new Map<string, string>();
	return {
		data,
		async get(key: string) {
			return data.get(key) ?? null;
		},
		async put(key: string, value: string) {
			data.set(key, value);
		},
	};
}

function probeEnv(store = memoryKv()): ProbeEnv {
	return {
		PROBE_RUN_KEY: RUN_KEY,
		PROBE_MODEL: "gpt-5.6-luna",
		CHATGPT_ACCESS_TOKEN: accessToken(1),
		CHATGPT_REFRESH_TOKEN: refreshToken(1),
		STORE: store,
	};
}

function runRequest(key = RUN_KEY) {
	const request = new Request("https://probe.example.workers.dev/run", {
		method: "POST",
		headers: { "x-probe-key": key },
	});
	// workerd attaches the data centre that served the request.
	Object.defineProperty(request, "cf", { value: { colo: "AMS" } });
	return request;
}

async function run(env: ProbeEnv, provider: ReturnType<typeof simulatedProvider>) {
	const response = await handleProbe(runRequest(), env, provider.fetch);
	expect(response.status).toBe(200);
	const text = await response.text();
	expectNoSecrets(text);
	return JSON.parse(text) as ProbeRun;
}

describe("free-tier probe Worker", () => {
	it("refuses a run without the run key and sends nothing to the provider", async () => {
		const provider = simulatedProvider();
		const response = await handleProbe(runRequest("wrong"), probeEnv(), provider.fetch);

		expect(response.status).toBe(401);
		expect(provider.hosts).toEqual([]);
	});

	it("refreshes the token, then sends one inference request on the new token", async () => {
		const provider = simulatedProvider();
		const result = await run(probeEnv(), provider);

		expect(result.outcome).toBe("pass");
		expect(provider.hosts).toEqual([
			"auth.openai.com/oauth/token",
			"chatgpt.com/backend-api/codex/responses",
		]);
		const entry = formatProbeEvidence(result);
		expect(entry).toMatch(/^#### \d{4}-\d{2}-\d{2} · .*ChatGPT.* from deployed Worker .* · pass\n/);
		expect(entry).toContain(
			"- **Network origin:** deployed Worker (Cloudflare network, free tier, data centre AMS)",
		);
		expect(entry).toMatch(
			/- \*\*Observed:\*\* refresh passed \(auth\.openai\.com\/oauth\/token 200\)/,
		);
		expect(entry).toMatch(
			/inference passed \(chatgpt\.com\/backend-api\/codex\/responses 200\): replied "pong"/,
		);
		expect(entry).toContain("- **Fallback:** none needed");
		expectNoSecrets(entry);
	});

	it("keeps the rotated refresh token, so a run on a later day still refreshes", async () => {
		const provider = simulatedProvider();
		const env = probeEnv();
		await run(env, provider);
		const second = await run(env, provider);

		expect(second.outcome).toBe("pass");
		expect(provider.generation()).toBe(3);
	});

	it("records a refused refresh, redacted, and still tries inference on the old token", async () => {
		const body = JSON.stringify({
			error: "invalid_grant",
			refresh_token: refreshToken(1),
			account: ACCOUNT_ID,
			email: EMAIL,
		});
		const provider = simulatedProvider({ refresh: { status: 400, body } });
		const result = await run(probeEnv(), provider);

		expect(result.outcome).toBe("fail");
		expect(provider.hosts).toHaveLength(2);
		const entry = formatProbeEvidence(result);
		expect(entry).toMatch(
			/refresh failed \(auth\.openai\.com\/oauth\/token 400\): .*invalid_grant/,
		);
		expect(entry).toContain("inference passed");
		expect(entry).toMatch(/- \*\*Fallback:\*\* .*container route/);
		expectNoSecrets(entry);
	});

	it("records a provider that blocks Cloudflare's addresses", async () => {
		const provider = simulatedProvider({
			responses: { status: 403, body: "<html>Sorry, you have been blocked</html>" },
		});
		const result = await run(probeEnv(), provider);

		expect(result.outcome).toBe("fail");
		const entry = formatProbeEvidence(result);
		expect(entry).toMatch(
			/inference failed \(chatgpt\.com\/backend-api\/codex\/responses 403\): .*blocked/,
		);
		expectNoSecrets(entry);
	});
});
